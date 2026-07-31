import base64
from email.parser import BytesParser
from email.policy import default as email_policy
import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional
import urllib.parse
import urllib.request

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "")
BEDROCK_MAX_TOKENS = int(os.environ.get("BEDROCK_MAX_TOKENS", "1200"))
DANA_BASE_URL = os.environ.get("DANA_BASE_URL", "https://appserv.danaconnect.com").rstrip("/")
DANA_TOKEN_URL = os.environ.get("DANA_TOKEN_URL", "https://auth.danaconnect.com/oauth2/token")
DANA_ACCESS_TOKEN = os.environ.get("DANA_ACCESS_TOKEN", "")
DANA_CLIENT_ID = os.environ.get("DANA_CLIENT_ID", "")
DANA_CLIENT_SECRET = os.environ.get("DANA_CLIENT_SECRET", "")
DANA_OAUTH_SCOPE = os.environ.get("DANA_OAUTH_SCOPE", "")
DANA_OAUTH_AUTH_METHOD = os.environ.get("DANA_OAUTH_AUTH_METHOD", "basic").lower()
DANA_USERNAME = os.environ.get("DANA_USERNAME", "")
DANA_PASSWORD = os.environ.get("DANA_PASSWORD", "")
DANA_FILE_UPLOAD_PATH = os.environ.get("DANA_FILE_UPLOAD_PATH", "/dana/conversation/http/rest/file/upload")
DANA_TOKEN_AUDIT_PROJECT_ID = os.environ.get("DANA_TOKEN_AUDIT_PROJECT_ID", "")
DANA_TIMEOUT_SECONDS = int(os.environ.get("DANA_TIMEOUT_SECONDS", "20"))
DANA_CONVERSATION_DEBUG = os.environ.get("DANA_CONVERSATION_DEBUG", "0")
LAMBDA_NAME = os.environ.get("AWS_LAMBDA_FUNCTION_NAME", "Portal_auto")
DOCUMENTS_S3_BUCKET = os.environ.get("DOCUMENTS_S3_BUCKET", "mercantilseguros-dana")

bedrock = boto3.client(
    "bedrock-runtime",
    region_name=AWS_REGION,
    config=Config(read_timeout=300, connect_timeout=10, retries={"max_attempts": 2}),
)
textract = boto3.client(
    "textract",
    region_name=AWS_REGION,
    config=Config(read_timeout=60, connect_timeout=10, retries={"max_attempts": 2}),
)
s3 = boto3.client(
    "s3",
    region_name=AWS_REGION,
    config=Config(read_timeout=60, connect_timeout=10, retries={"max_attempts": 2}),
)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,x-api-key",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
}

DOCUMENT_TYPE_LABELS = {
    "certificate_of_origin": "Certificado de origen",
    "circulation_card": "Carnet de circulación",
    "unknown": "Documento no reconocido",
}

SUPPORTED_ACTIONS = {"extract_vehicle_document"}

TOKEN_CACHE = {"access_token": "", "expires_at": 0}

TOKEN_AUDIT_FIELD_MAP = {
    "lambdaName": "LAMBDA_NAME",
    "modelId": "MODEL_ID",
    "inputTokens": "TOKEN_INPUT",
    "outputTokens": "TOKEN_OUTPUT",
    "totalTokens": "TOKENS_TOTALES",
    "reasonCode": "RESULTADO_VALIDOC",
    "fileName": "NOMBRE_ARCHIVO_DOC",
}


class BedrockExtractionError(Exception):
    def __init__(self, message: str, token_usage: Dict[str, int]):
        super().__init__(message)
        self.token_usage = token_usage


class MultipartRequestError(Exception):
    pass


def response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, ensure_ascii=False),
    }


def post_json(url: str, payload: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers=headers,
    )
    with urllib.request.urlopen(request, timeout=DANA_TIMEOUT_SECONDS) as result:
        raw = result.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def get_dana_access_token() -> str:
    if DANA_ACCESS_TOKEN:
        return DANA_ACCESS_TOKEN

    now = int(time.time())
    if TOKEN_CACHE["access_token"] and TOKEN_CACHE["expires_at"] > now + 60:
        return TOKEN_CACHE["access_token"]

    if not DANA_CLIENT_ID or not DANA_CLIENT_SECRET:
        raise ValueError("Faltan credenciales OAuth para registrar auditoría en DANA.")

    form_payload = {"grant_type": "client_credentials"}
    if DANA_OAUTH_SCOPE:
        form_payload["scope"] = DANA_OAUTH_SCOPE

    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }
    if DANA_OAUTH_AUTH_METHOD == "body":
        form_payload["client_id"] = DANA_CLIENT_ID
        form_payload["client_secret"] = DANA_CLIENT_SECRET
    else:
        credentials = f"{DANA_CLIENT_ID}:{DANA_CLIENT_SECRET}".encode("utf-8")
        headers["Authorization"] = f"Basic {base64.b64encode(credentials).decode('utf-8')}"

    request = urllib.request.Request(
        DANA_TOKEN_URL,
        data=urllib.parse.urlencode(form_payload).encode("utf-8"),
        method="POST",
        headers=headers,
    )
    with urllib.request.urlopen(request, timeout=DANA_TIMEOUT_SECONDS) as result:
        token_response = json.loads(result.read().decode("utf-8"))

    access_token = token_response.get("access_token")
    if not access_token:
        raise ValueError("DANAconnect no devolvió access_token.")

    TOKEN_CACHE["access_token"] = access_token
    TOKEN_CACHE["expires_at"] = now + int(token_response.get("expires_in", 300))
    return access_token


def start_conversation_project_url(project_id: str) -> str:
    encoded_project_id = urllib.parse.quote(str(project_id), safe="")
    return f"{DANA_BASE_URL}/api/2.0/rest/conversation/ProjectID/{encoded_project_id}/start/data"


def dana_file_upload_url() -> str:
    return f"{DANA_BASE_URL}{DANA_FILE_UPLOAD_PATH}"


def dana_basic_headers() -> Dict[str, str]:
    credentials = f"{DANA_USERNAME}:{DANA_PASSWORD}".encode("utf-8")
    return {
        "Authorization": f"Basic {base64.b64encode(credentials).decode('utf-8')}",
        "Accept": "application/json",
    }


def parse_bedrock_token_usage(result: Dict[str, Any]) -> Dict[str, int]:
    usage = result.get("usage") or {}
    input_tokens = int(usage.get("inputTokens") or usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("outputTokens") or usage.get("output_tokens") or 0)
    total_tokens = int(usage.get("totalTokens") or usage.get("total_tokens") or input_tokens + output_tokens)
    return {
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "totalTokens": total_tokens,
    }


def build_token_audit_fields(
    body: Dict[str, Any],
    document: Dict[str, Any],
    extraction: Optional[Dict[str, Any]],
    token_usage: Dict[str, int],
    result_code: str,
) -> Dict[str, str]:
    del body
    values = {
        "lambdaName": LAMBDA_NAME,
        "modelId": BEDROCK_MODEL_ID,
        "inputTokens": str(token_usage.get("inputTokens", 0)),
        "outputTokens": str(token_usage.get("outputTokens", 0)),
        "totalTokens": str(token_usage.get("totalTokens", 0)),
        "reasonCode": result_code,
        "fileName": filename_of(document),
    }
    return {
        field_code: values[key]
        for key, field_code in TOKEN_AUDIT_FIELD_MAP.items()
        if field_code and key in values
    }


def record_bedrock_token_usage(
    body: Dict[str, Any],
    document: Dict[str, Any],
    extraction: Optional[Dict[str, Any]],
    token_usage: Dict[str, int],
    result_code: str,
) -> None:
    if not DANA_TOKEN_AUDIT_PROJECT_ID:
        return

    fields = build_token_audit_fields(body, document, extraction, token_usage, result_code)
    logger.info(
        "token_audit_start_conversation_request project_id=%s total_tokens=%s fields=%s",
        DANA_TOKEN_AUDIT_PROJECT_ID,
        token_usage.get("totalTokens", 0),
        list(fields.keys()),
    )
    try:
        result = post_json(
            start_conversation_project_url(DANA_TOKEN_AUDIT_PROJECT_ID),
            fields,
            {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {get_dana_access_token()}",
                "X-DEBUG": DANA_CONVERSATION_DEBUG,
            },
        )
        logger.info("token_audit_start_conversation_response keys=%s", list(result.keys()))
    except Exception as exc:
        logger.warning("token_audit_start_conversation_failed error=%s", exc)


def request_header(event: Dict[str, Any], name: str) -> str:
    headers = event.get("headers") or {}
    target = name.lower()
    for key, value in headers.items():
        if str(key).lower() == target:
            return str(value or "")
    return ""


def parse_multipart_body(event: Dict[str, Any]) -> Dict[str, Any]:
    content_type = request_header(event, "content-type")
    if "multipart/form-data" not in content_type.lower():
        raise MultipartRequestError("Content-Type debe ser multipart/form-data.")

    raw_body = event.get("body")
    if not raw_body:
        raise MultipartRequestError("Body multipart vacío.")

    if not event.get("isBase64Encoded"):
        raise MultipartRequestError(
            "API Gateway debe entregar multipart/form-data como base64. "
            "Configura Binary Media Types para multipart/form-data y despliega el stage."
        )
    body_bytes = base64.b64decode(raw_body)

    message_bytes = (
        f"Content-Type: {content_type}\r\n"
        "MIME-Version: 1.0\r\n\r\n"
    ).encode("utf-8") + body_bytes
    message = BytesParser(policy=email_policy).parsebytes(message_bytes)
    if not message.is_multipart():
        raise MultipartRequestError("Body multipart inválido.")

    fields: Dict[str, str] = {}
    document: Optional[Dict[str, Any]] = None
    for part in message.iter_parts():
        if part.get_content_disposition() != "form-data":
            continue
        name = part.get_param("name", header="content-disposition")
        filename = part.get_filename()
        payload = part.get_payload(decode=True) or b""

        if filename or name == "file":
            document = {
                "fileName": filename or "documento",
                "contentType": part.get_content_type(),
                "_file_bytes": payload,
            }
            continue

        if name:
            charset = part.get_content_charset() or "utf-8"
            fields[str(name)] = payload.decode(charset, errors="replace")

    if not document:
        raise MultipartRequestError("Debe enviarse el archivo en el campo file.")
    if not document.get("_file_bytes"):
        raise MultipartRequestError("El archivo recibido está vacío.")

    return {
        "action": fields.get("action") or "extract_vehicle_document",
        "document": document,
        "fields": fields,
        "uploadToDana": parse_bool(fields.get("uploadToDana") or fields.get("upload_to_dana")),
    }


def parse_json_body(event: Dict[str, Any]) -> Dict[str, Any]:
    raw_body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw_body = base64.b64decode(raw_body).decode("utf-8")
    return json.loads(raw_body)


def parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    content_type = request_header(event, "content-type").lower()
    if "multipart/form-data" in content_type:
        return parse_multipart_body(event)
    return parse_json_body(event)


def http_method(event: Dict[str, Any]) -> str:
    return event.get("httpMethod") or event.get("requestContext", {}).get("http", {}).get("method", "POST")


def normalize_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


def parse_bool(value: Any) -> bool:
    return str(value or "").strip().strip("\"'").lower() in {"true", "1", "si", "sí", "yes", "y"}


def normalize_upper(value: Any) -> Optional[str]:
    text = normalize_text(value)
    return text.upper() if text else None


def normalize_id(value: Any) -> Optional[str]:
    text = normalize_upper(value)
    return re.sub(r"\s+", "", text) if text else None


def normalize_plate(value: Any) -> Optional[str]:
    text = normalize_upper(value)
    return re.sub(r"[^A-Z0-9]", "", text) if text else None


def normalize_vin(value: Any) -> Optional[str]:
    text = normalize_upper(value)
    return re.sub(r"[^A-Z0-9]", "", text) if text else None


def normalize_year(value: Any) -> Optional[str]:
    text = normalize_text(value)
    if not text:
        return None
    match = re.search(r"\b(?:19|20)\d{2}\b", text)
    return match.group(0) if match else None


def filename_of(document: Dict[str, Any]) -> str:
    explicit_filename = document.get("fileName") or document.get("filename")
    if explicit_filename:
        return explicit_filename

    try:
        _, key = s3_location_of(document)
    except ValueError:
        return ""
    return urllib.parse.unquote(key.rsplit("/", 1)[-1]) if key else ""


def content_type_of(document: Dict[str, Any]) -> str:
    ext = extension_of(filename_of(document))
    if ext == "pdf":
        return "application/pdf"
    if ext == "png":
        return "image/png"
    if ext in {"jpg", "jpeg"}:
        return "image/jpeg"
    return document.get("contentType") or document.get("content_type") or ""


def document_source_of(document: Dict[str, Any]) -> str:
    return str(document.get("source") or "").strip()


def is_s3_uri(value: str) -> bool:
    return value.lower().startswith("s3://")


def is_https_s3_url(value: str) -> bool:
    if not value.lower().startswith("https://"):
        return False
    try:
        parse_s3_url(value)
        return True
    except ValueError:
        return False


def extension_of(filename: str) -> str:
    if "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower().strip()


def is_image_document(document: Dict[str, Any]) -> bool:
    filename = filename_of(document)
    content_type = content_type_of(document)
    return extension_of(filename) in {"png", "jpg", "jpeg"} or content_type.startswith("image/")


def is_pdf_document(document: Dict[str, Any]) -> bool:
    filename = filename_of(document)
    content_type = content_type_of(document)
    return extension_of(filename) == "pdf" or content_type == "application/pdf"


def file_signature(file_bytes: bytes) -> str:
    return file_bytes[:8].hex().upper()


def validate_document_bytes(file_bytes: bytes, document: Dict[str, Any]) -> Optional[str]:
    if is_pdf_document(document) and not file_bytes.startswith(b"%PDF"):
        return "El archivo fue recibido como PDF, pero los bytes no tienen firma PDF válida."
    if is_image_document(document):
        ext = extension_of(filename_of(document))
        content_type = content_type_of(document)
        expects_png = ext == "png" or content_type == "image/png"
        expects_jpeg = ext in {"jpg", "jpeg"} or content_type == "image/jpeg"
        if expects_png and not file_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            return "El archivo fue recibido como PNG, pero los bytes no tienen firma PNG válida."
        if expects_jpeg and not file_bytes.startswith(b"\xff\xd8\xff"):
            return "El archivo fue recibido como JPG/JPEG, pero los bytes no tienen firma JPEG válida."
    return None


def bedrock_image_format(document: Dict[str, Any]) -> str:
    ext = extension_of(filename_of(document))
    return "png" if ext == "png" else "jpeg"


def validate_document(document: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    filename = filename_of(document)
    if not filename:
        errors.append("fileName es requerido cuando no puede inferirse desde S3.")

    source = document_source_of(document)
    has_uploaded_file = bool(document.get("_file_bytes"))
    has_base64 = bool(document.get("content_base64") or (source and not is_s3_uri(source) and not is_https_s3_url(source)))
    has_s3_reference = bool(
        is_s3_uri(source)
        or is_https_s3_url(source)
        or document.get("s3_bucket")
        or document.get("s3Bucket")
        or document.get("s3_uri")
        or document.get("s3Uri")
        or document.get("s3_url")
        or document.get("s3Url")
    )
    if not has_uploaded_file and not has_base64 and not has_s3_reference:
        errors.append("Debe enviarse document.source, content_base64, una referencia S3 o multipart/form-data campo file.")
    if has_s3_reference:
        try:
            if s3_url_of(document):
                parse_s3_url(s3_url_of(document) or "")
            else:
                s3_location_of(document)
        except ValueError as exc:
            errors.append(str(exc))

    if filename and not is_pdf_document(document) and not is_image_document(document):
        errors.append("El documento debe ser PDF, PNG o JPG.")
    return errors


def parse_s3_uri(value: str) -> tuple[str, str]:
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path.strip("/"):
        raise ValueError("s3_uri debe tener formato s3://bucket/key.")

    if not is_valid_s3_bucket_name(parsed.netloc):
        if not DOCUMENTS_S3_BUCKET:
            raise ValueError(
                "Ruta S3 con bucket no estándar. Configure DOCUMENTS_S3_BUCKET para resolver esta ruta."
            )
        key = f"{parsed.netloc}{parsed.path}"
        return DOCUMENTS_S3_BUCKET, urllib.parse.unquote(key.lstrip("/"))

    return parsed.netloc, urllib.parse.unquote(parsed.path.lstrip("/"))


def is_valid_s3_bucket_name(value: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", value or ""))


def parse_s3_url(value: str) -> tuple[str, str]:
    parsed = urllib.parse.urlparse(value)
    host = parsed.netloc.lower()
    path_parts = [part for part in parsed.path.split("/") if part]

    if parsed.scheme != "https" or not host:
        raise ValueError("s3_url debe ser una URL HTTPS de S3.")

    if ".s3." in host or host.endswith(".s3.amazonaws.com"):
        bucket = host.split(".s3", 1)[0]
        key = "/".join(path_parts)
    elif host.startswith("s3.") or host == "s3.amazonaws.com":
        if len(path_parts) < 2:
            raise ValueError("s3_url debe incluir bucket y key del objeto.")
        bucket = path_parts[0]
        key = "/".join(path_parts[1:])
    else:
        raise ValueError("s3_url debe apuntar a un host de Amazon S3.")

    if not bucket or not key:
        raise ValueError("s3_url debe incluir bucket y key del objeto.")
    return bucket, urllib.parse.unquote(key)


def s3_location_of(document: Dict[str, Any]) -> tuple[str, str]:
    bucket = document.get("s3_bucket") or document.get("s3Bucket")
    key = document.get("s3_key") or document.get("s3Key")
    if bucket and key:
        return str(bucket), str(key).lstrip("/")

    s3_uri = (
        document_source_of(document)
        if is_s3_uri(document_source_of(document))
        else None
    ) or (
        document.get("s3_uri")
        or document.get("s3Uri")
    )
    if s3_uri:
        return parse_s3_uri(str(s3_uri))

    s3_url = document.get("s3_url") or document.get("s3Url")
    if s3_url:
        return parse_s3_url(str(s3_url))

    raise ValueError("Referencia S3 inválida. Use s3_uri, s3_url o s3_bucket + s3_key.")


def s3_url_of(document: Dict[str, Any]) -> Optional[str]:
    source = document_source_of(document)
    if source and is_https_s3_url(source):
        return source

    value = document.get("s3_url") or document.get("s3Url")
    return str(value) if value else None


def read_s3_url_bytes(value: str) -> bytes:
    parse_s3_url(value)
    with urllib.request.urlopen(value, timeout=60) as result:
        return result.read()


def read_document_bytes(document: Dict[str, Any]) -> bytes:
    if document.get("_file_bytes"):
        return document["_file_bytes"]

    source = document_source_of(document)
    if source and not is_s3_uri(source) and not is_https_s3_url(source):
        return decode_base64_value(source)

    if document.get("content_base64"):
        return decode_base64_document(document)

    s3_url = s3_url_of(document)
    if s3_url:
        try:
            return read_s3_url_bytes(s3_url)
        except Exception as exc:
            logger.info("No se pudo leer s3_url directamente; se intentará con IAM. error=%s", exc)

    bucket, key = s3_location_of(document)
    try:
        result = s3.get_object(Bucket=bucket, Key=key)
        return result["Body"].read()
    except (ClientError, BotoCoreError) as exc:
        raise ValueError("No se pudo leer el documento desde S3.") from exc


def decode_base64_document(document: Dict[str, Any]) -> bytes:
    return decode_base64_value(document.get("content_base64") or "")


def decode_base64_value(value: str) -> bytes:
    try:
        return base64.b64decode(value)
    except Exception as exc:
        raise ValueError("document.source/base64 inválido.") from exc


def build_multipart_body(field_name: str, file_name: str, content_type: str, file_bytes: bytes) -> tuple[str, bytes]:
    boundary = f"----portalauto{int(time.time() * 1000)}"
    header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; filename="{file_name}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8")
    footer = f"\r\n--{boundary}--\r\n".encode("utf-8")
    return boundary, header + file_bytes + footer


def upload_file_to_dana(document: Dict[str, Any], file_bytes: bytes) -> Dict[str, Any]:
    if not DANA_USERNAME or not DANA_PASSWORD:
        raise ValueError("DANA_USERNAME y DANA_PASSWORD son requeridos para File Upload.")

    content_type = content_type_of(document) or "application/octet-stream"
    boundary, multipart_body = build_multipart_body(
        "file",
        filename_of(document),
        content_type,
        file_bytes,
    )
    request = urllib.request.Request(
        dana_file_upload_url(),
        data=multipart_body,
        method="POST",
        headers={
            **dana_basic_headers(),
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "X-DEBUG": DANA_CONVERSATION_DEBUG,
        },
    )
    with urllib.request.urlopen(request, timeout=DANA_TIMEOUT_SECONDS) as result:
        raw = result.read().decode("utf-8", errors="replace")
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"raw": raw}


def build_public_upload_response(upload_result: Dict[str, Any]) -> Dict[str, Any]:
    file_id = (
        upload_result.get("fileID")
        or upload_result.get("fileId")
        or upload_result.get("id")
        or upload_result.get("path")
        or upload_result.get("url")
    )
    return {
        "uploaded": bool(file_id or upload_result),
        "fileID": file_id,
        "reference": file_id,
        "raw": upload_result,
    }


def detect_document_type_from_text(text: str) -> str:
    upper = text.upper()
    if "CERTIFICADO DE ORIGEN" in upper:
        return "certificate_of_origin"
    if "CERTIFICADO DE REGISTRO DE VEHICULO" in upper or "CERTIFICADO DE REGISTRO DE VEHÍCULO" in upper:
        return "certificate_of_origin"
    if "TITULO" in upper or "TÍTULO" in upper:
        return "certificate_of_origin"
    if "CERTIFICADO DE CIRCULACION" in upper or "CERTIFICADO DE CIRCULACIÓN" in upper:
        return "circulation_card"
    return "unknown"


def detect_document_type_from_filename(document: Dict[str, Any]) -> str:
    filename = filename_of(document).lower()
    if "carnet" in filename or "circulacion" in filename or "circulation" in filename:
        return "circulation_card"
    if "origen" in filename or "titulo" in filename or "title" in filename or "propiedad" in filename:
        return "certificate_of_origin"
    if "registro" in filename and ("vehiculo" in filename or "vehicular" in filename):
        return "certificate_of_origin"
    return "unknown"


def detect_document_type(document: Dict[str, Any], text: Optional[str] = None) -> str:
    filename_detected = detect_document_type_from_filename(document)
    if filename_detected == "certificate_of_origin":
        return filename_detected

    if text:
        detected = detect_document_type_from_text(text)
        if detected != "unknown":
            return detected

    return filename_detected


def empty_vehicle(document_type: str) -> Dict[str, Any]:
    return {
        "documentType": document_type,
        "ownerId": None,
        "ownerName": None,
        "plate": None,
        "vin": None,
        "engineSerial": None,
        "brand": None,
        "model": None,
        "year": None,
        "color": None,
        "vehicleClass": None,
        "useType": None,
        "weightKg": None,
        "axles": None,
        "seats": None,
    }


def missing_fields_for(vehicle: Dict[str, Any]) -> List[str]:
    missing: List[str] = []
    if not vehicle.get("brand"):
        missing.append("brand")
    if not vehicle.get("model"):
        missing.append("model")
    if not vehicle.get("year"):
        missing.append("year")
    if not vehicle.get("vin"):
        missing.append("vin")
    if vehicle.get("documentType") == "circulation_card" and not vehicle.get("plate"):
        missing.append("plate")
    return missing


def merge_missing_fields(raw_missing_fields: Any, vehicle: Dict[str, Any]) -> List[str]:
    fields: List[str] = []
    if isinstance(raw_missing_fields, list):
        fields.extend(str(field) for field in raw_missing_fields if field)
    fields.extend(missing_fields_for(vehicle))
    return list(dict.fromkeys(fields))


def confidence_as_percentage(value: Any) -> Optional[float]:
    if not isinstance(value, (int, float)):
        return None
    return round(float(value) * 100, 2) if value <= 1 else round(float(value), 2)


def public_vehicle_payload(vehicle: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "documentType": vehicle.get("documentType"),
        "ownerId": vehicle.get("ownerId"),
        "ownerName": vehicle.get("ownerName"),
        "plate": vehicle.get("plate"),
        "vin": vehicle.get("vin"),
        "engineSerial": vehicle.get("engineSerial"),
        "brand": vehicle.get("brand"),
        "model": vehicle.get("model"),
        "year": vehicle.get("year"),
        "color": vehicle.get("color"),
        "vehicleClass": vehicle.get("vehicleClass"),
        "useType": vehicle.get("useType"),
        "weightKg": vehicle.get("weightKg"),
        "axles": vehicle.get("axles"),
        "seats": vehicle.get("seats"),
    }


def build_public_extraction_response(document: Dict[str, Any], extraction: Dict[str, Any]) -> Dict[str, Any]:
    document_type = extraction.get("document_type") or "unknown"
    missing_fields = extraction.get("missing_fields")
    messages = extraction.get("messages")

    return {
        "ok": True,
        "document": {
            "valid": bool(extraction.get("document_valid")),
            "type": document_type,
            "label": DOCUMENT_TYPE_LABELS.get(document_type, DOCUMENT_TYPE_LABELS["unknown"]),
            "fileName": filename_of(document),
            "confidence": confidence_as_percentage(extraction.get("confidence")),
            "missingFields": missing_fields if isinstance(missing_fields, list) else [],
            "messages": messages if isinstance(messages, list) else [],
        },
        "vehicle": public_vehicle_payload(extraction.get("vehicle") or {}),
    }


def should_upload_to_dana(body: Dict[str, Any]) -> bool:
    return parse_bool(body.get("uploadToDana") or body.get("upload_to_dana"))


def invalid_document_body(extraction: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    document_type = (extraction or {}).get("document_type") or "unknown"
    return {
        "ok": False,
        "message": "Documento inválido o ilegible. Por favor carga un certificado de origen o carnet de circulación válido y legible.",
        "document": {
            "valid": False,
            "type": document_type,
            "label": DOCUMENT_TYPE_LABELS.get(document_type, DOCUMENT_TYPE_LABELS["unknown"]),
            "confidence": confidence_as_percentage((extraction or {}).get("confidence")),
            "missingFields": (extraction or {}).get("missing_fields") or [],
            "messages": (extraction or {}).get("messages") or [],
        },
    }


def is_invalid_or_illegible(extraction: Dict[str, Any]) -> bool:
    document_type = extraction.get("document_type")
    vehicle = extraction.get("vehicle") or {}
    confidence = extraction.get("confidence")

    if document_type not in {"certificate_of_origin", "circulation_card"}:
        return True
    if not extraction.get("document_valid"):
        return True

    has_vin = bool(vehicle.get("vin"))
    has_vehicle_description = any(vehicle.get(field) for field in ["brand", "model", "year", "plate"])
    if not has_vin or not has_vehicle_description:
        return True

    if document_type == "circulation_card" and not vehicle.get("plate"):
        return True

    if isinstance(confidence, (int, float)) and confidence < 0.5:
        return True

    return False


def invalid_document_response(extraction: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return response(422, invalid_document_body(extraction))


def safe_json_loads(raw: str) -> Dict[str, Any]:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            raise ValueError("Bedrock no devolvió JSON válido.")
        return json.loads(match.group(0))


def extract_text_from_textract(file_bytes: bytes, document: Dict[str, Any]) -> Optional[str]:
    # Por ahora Textract se usa como OCR auxiliar para imágenes. PDFs visuales van directo a Bedrock.
    if not is_image_document(document):
        return None

    result = textract.detect_document_text(Document={"Bytes": file_bytes})
    lines = [
        block.get("Text", "")
        for block in result.get("Blocks", [])
        if block.get("BlockType") == "LINE" and block.get("Text")
    ]
    return "\n".join(lines) or None


def build_prompt(ocr_text: Optional[str]) -> str:
    return f"""
Eres un extractor documental de vehículos en Venezuela.
Analiza el documento adjunto. Puede ser:
- Certificado de origen / certificado de registro / título de propiedad del vehículo.
- Carnet o certificado de circulación del INTT.

Devuelve exclusivamente JSON válido. No uses markdown ni explicaciones.
No inventes datos. Si un campo no aparece claramente, usa null.
No completes campos por conocimiento general, patrones, marcas conocidas, nombres de archivo, valores esperados o contexto del negocio.
Solo extrae valores que estén visibles en el documento adjunto o en el texto OCR de apoyo.
Si un valor está parcialmente visible, borroso, ambiguo o no puedes distinguirlo con seguridad, usa null y agrega el campo a missing_fields.
No corrijas ni normalices un valor si eso requiere adivinar caracteres; conserva únicamente lo legible.

Esquema exacto:
{{
  "document_valid": false,
  "document_type": "certificate_of_origin | circulation_card | unknown",
  "confidence": 0,
  "vehicle": {{
    "ownerId": null,
    "ownerName": null,
    "plate": null,
    "vin": null,
    "engineSerial": null,
    "brand": null,
    "model": null,
    "year": null,
    "color": null,
    "vehicleClass": null,
    "useType": null,
    "weightKg": null,
    "axles": null,
    "seats": null
  }},
  "missing_fields": [],
  "messages": []
}}

Reglas de identificación:
- Solo son documentos válidos: certificado/título de origen/registro vehicular y carnet/certificado de circulación.
- document_type = "certificate_of_origin" si el documento principal tiene encabezados como "Certificado de Origen", "Certificado de Registro de Vehículo", "Título", "Título de Propiedad" o "Propiedad del Vehículo".
- document_type = "circulation_card" si el documento principal tiene encabezado "Certificado de Circulación", "Carnet de Circulación" o formato de carnet INTT.
- Si un PDF contiene varias páginas o secciones, clasifica según el documento principal o encabezado dominante. No clasifiques como "circulation_card" solo porque aparezca una mención secundaria a circulación dentro de un certificado/título.
- En certificado de origen/título puede no existir placa; eso no invalida el documento.
- En carnet de circulación, placa y vin/serial de carrocería son campos críticos.

Reglas de extracción:
- ownerId: cédula/RIF del titular si aparece. Ejemplo del carnet: V24657722.
- ownerName: nombre completo del titular si aparece. Ejemplo: MARIA MILAGROS LASTRA PEREZ.
- plate: valor junto a "Placa". Ejemplo: AA635EE.
- vin: valor junto a "Serial N.I.V.", "S. Carrocería", "NIV", "VIN", "serial carrocería" o "chasis". Ejemplo carnet: 8XBBA42E6B7816125. No uses como vin el número largo superior del carnet si no está etiquetado como N.I.V./carrocería/chasis.
- engineSerial: serial de motor si aparece claramente; si no aparece, usa null.
- brand: marca del vehículo. Ejemplo: KIA.
- model: modelo/versión. Ejemplo: PICANTO EX.
- year: año del vehículo. Ejemplo: 2007.
- color: color visible. Ejemplo: AZUL.
- vehicleClass: clase/tipo. Ejemplos: AUTOMOVIL, SEDAN, CAMIONETA. Si aparecen "AUTOMOVIL" y "SEDAN", conserva el valor más completo posible.
- useType: uso. Ejemplo: PARTICULAR.
- weightKg: peso en kg si aparece, sin texto adicional. Ejemplo: 400.
- axles: número de ejes si aparece. Ejemplo: 2.
- seats: puestos si aparece. Ejemplo: 5.
- missing_fields: lista de campos críticos o esperados que no pudieron extraerse con claridad. Usa los nombres del JSON, por ejemplo: ["engineSerial", "color"].

Guía específica para carnet de circulación:
- Suele mostrar "CERTIFICADO DE CIRCULACIÓN" como título.
- Extrae "Placa" como plate.
- Extrae "Serial N.I.V. (S. Carrocería)" como vin.
- Extrae peso desde "KGS", ejes desde "EJES", color desde el texto de color y puestos desde "PTOS".

Guía específica para certificado de origen/título:
- Puede llamarse "Certificado de Registro de Vehículo", "Certificado de Origen", "Título" o similar.
- Puede incluir datos administrativos como fecha de emisión o número de autorización; esos datos pueden ir en messages, pero no reemplazan los campos del vehículo.
- La placa puede estar ausente; no la inventes.

Control anti-alucinación:
- Nunca derives marca, modelo, año, color, placa, VIN, serial de motor, peso, ejes o puestos si no se ven en el documento.
- Nunca uses ejemplos de este prompt como datos reales.
- Nunca asumas que un vehículo tiene 5 puestos, 2 ejes o uso PARTICULAR si no aparece.
- Si hay conflicto entre el OCR auxiliar y la imagen/documento adjunto, prioriza lo visible en el documento adjunto.

Texto OCR de apoyo, si existe:
{ocr_text or "No disponible"}
""".strip()


def make_bedrock_content(file_bytes: bytes, document: Dict[str, Any], ocr_text: Optional[str]) -> List[Dict[str, Any]]:
    content: List[Dict[str, Any]] = [{"text": build_prompt(ocr_text)}]

    if is_pdf_document(document):
        content.append(
            {
                "document": {
                    "format": "pdf",
                    "name": "vehicle_document",
                    "source": {"bytes": file_bytes},
                }
            }
        )
        return content

    if is_image_document(document):
        content.append(
            {
                "image": {
                    "format": bedrock_image_format(document),
                    "source": {"bytes": file_bytes},
                }
            }
        )
        return content

    return content


def read_bedrock_text(result: Dict[str, Any]) -> str:
    content_blocks = result.get("output", {}).get("message", {}).get("content", [])
    texts = [block.get("text", "") for block in content_blocks if block.get("text")]
    return "\n".join(texts).strip()


def normalize_bedrock_extraction(raw: Dict[str, Any], document: Dict[str, Any], ocr_text: Optional[str]) -> Dict[str, Any]:
    vehicle_raw = raw.get("vehicle") or {}
    document_type = detect_document_type(document, f"{raw.get('document_type') or ''}\n{ocr_text or ''}")

    vehicle = empty_vehicle(document_type)
    vehicle.update(
        {
            "ownerId": normalize_id(vehicle_raw.get("ownerId")),
            "ownerName": normalize_text(vehicle_raw.get("ownerName")),
            "plate": normalize_plate(vehicle_raw.get("plate")),
            "vin": normalize_vin(vehicle_raw.get("vin")),
            "engineSerial": normalize_upper(vehicle_raw.get("engineSerial")),
            "brand": normalize_upper(vehicle_raw.get("brand")),
            "model": normalize_upper(vehicle_raw.get("model")),
            "year": normalize_year(vehicle_raw.get("year")),
            "color": normalize_upper(vehicle_raw.get("color")),
            "vehicleClass": normalize_upper(vehicle_raw.get("vehicleClass")),
            "useType": normalize_upper(vehicle_raw.get("useType")),
            "weightKg": normalize_text(vehicle_raw.get("weightKg")),
            "axles": normalize_text(vehicle_raw.get("axles")),
            "seats": normalize_text(vehicle_raw.get("seats")),
        }
    )

    messages = raw.get("messages") if isinstance(raw.get("messages"), list) else []
    return {
        "document_valid": bool(raw.get("document_valid", document_type != "unknown")),
        "document_type": document_type,
        "extraction_source": "bedrock",
        "confidence": float(raw.get("confidence") or 0.8),
        "vehicle": vehicle,
        "missing_fields": merge_missing_fields(raw.get("missing_fields"), vehicle),
        "messages": [str(message) for message in messages],
        "ocr_text": ocr_text,
    }


def extract_with_bedrock(
    file_bytes: bytes,
    document: Dict[str, Any],
    ocr_text: Optional[str],
) -> tuple[Dict[str, Any], Dict[str, int]]:
    if not BEDROCK_MODEL_ID:
        raise ValueError("BEDROCK_MODEL_ID no está configurado en variables de entorno.")

    result = bedrock.converse(
        modelId=BEDROCK_MODEL_ID,
        messages=[
            {
                "role": "user",
                "content": make_bedrock_content(file_bytes, document, ocr_text),
            }
        ],
        inferenceConfig={
            "temperature": 0,
            "maxTokens": BEDROCK_MAX_TOKENS,
        },
    )
    token_usage = parse_bedrock_token_usage(result)
    try:
        raw_text = read_bedrock_text(result)
        logger.info("Respuesta Bedrock raw=%s", raw_text)
        return normalize_bedrock_extraction(safe_json_loads(raw_text), document, ocr_text), token_usage
    except Exception as exc:
        raise BedrockExtractionError("Bedrock respondió, pero no se pudo normalizar la extracción.", token_usage) from exc


def handle_extract_vehicle_document(body: Dict[str, Any]) -> Dict[str, Any]:
    document = body.get("document") or {}
    if not isinstance(document, dict):
        return response(400, {"ok": False, "message": "document debe ser un objeto."})

    errors = validate_document(document)
    if errors:
        return response(400, {"ok": False, "message": "Documento inválido.", "errors": errors})

    try:
        file_bytes = read_document_bytes(document)
    except ValueError as exc:
        return response(400, {"ok": False, "message": "Documento inválido.", "errors": [str(exc)]})
    byte_error = validate_document_bytes(file_bytes, document)
    if byte_error:
        logger.warning(
            "document_bytes_invalid filename=%s content_type=%s size=%s signature=%s",
            filename_of(document),
            content_type_of(document),
            len(file_bytes),
            file_signature(file_bytes),
        )
        return response(
            400,
            {
                "ok": False,
                "message": "El archivo llegó corrupto o con un formato diferente al declarado.",
                "errors": [byte_error],
                "fileName": filename_of(document),
                "contentType": content_type_of(document),
                "size": len(file_bytes),
                "signature": file_signature(file_bytes),
            },
        )

    ocr_text: Optional[str] = None
    try:
        ocr_text = extract_text_from_textract(file_bytes, document)
    except (ClientError, BotoCoreError, ValueError) as exc:
        logger.warning("Textract no pudo extraer texto auxiliar: %s", exc)
        ocr_text = None

    try:
        extraction, token_usage = extract_with_bedrock(file_bytes, document, ocr_text)
        if is_invalid_or_illegible(extraction):
            record_bedrock_token_usage(body, document, extraction, token_usage, "INVALID_DOCUMENT")
            return invalid_document_response(extraction)
        record_bedrock_token_usage(body, document, extraction, token_usage, "VALID_DOCUMENT")
        response_body = build_public_extraction_response(document, extraction)
        if should_upload_to_dana(body):
            try:
                upload_result = upload_file_to_dana(document, file_bytes)
                response_body["danaUpload"] = build_public_upload_response(upload_result)
            except Exception as upload_error:
                logger.exception("Documento válido, pero falló el Upload API de DANA")
                return response(
                    502,
                    {
                        "ok": False,
                        "message": "El documento fue validado, pero no se pudo subir a DANA.",
                        "error": str(upload_error),
                        "document": response_body.get("document"),
                        "vehicle": response_body.get("vehicle"),
                    },
                )
        return response(200, response_body)
    except Exception as exc:
        logger.exception("No se pudo extraer con Bedrock")
        token_usage = (
            exc.token_usage
            if isinstance(exc, BedrockExtractionError)
            else {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}
        )
        record_bedrock_token_usage(
            body,
            document,
            None,
            token_usage,
            "VALIDATION_SERVICE_ERROR",
        )
        return response(
            500,
            {
                "ok": False,
                "message": "No se pudo extraer información del documento.",
                "error": str(exc),
            },
        )


def lambda_handler(event, context):
    try:
        method = http_method(event)

        if method == "OPTIONS":
            return response(200, {"ok": True})
        if method != "POST":
            return response(405, {"ok": False, "message": "Method not allowed."})

        body = parse_body(event)
        action = body.get("action") or "extract_vehicle_document"
        if action not in SUPPORTED_ACTIONS:
            return response(
                400,
                {
                    "ok": False,
                    "message": "Acción no soportada por ahora.",
                    "supported_actions": sorted(SUPPORTED_ACTIONS),
                },
            )

        return handle_extract_vehicle_document(body)
    except MultipartRequestError as exc:
        return response(400, {"ok": False, "message": "Body multipart inválido.", "errors": [str(exc)]})
    except json.JSONDecodeError:
        return response(400, {"ok": False, "message": "Body JSON inválido."})
    except Exception as exc:
        logger.exception("Error no controlado en vehicle-document")
        return response(
            500,
            {
                "ok": False,
                "message": "Error interno del servicio.",
                "error": str(exc),
                "errorType": type(exc).__name__,
            },
        )
