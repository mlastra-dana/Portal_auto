import base64
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
DANA_TOKEN_AUDIT_PROJECT_ID = os.environ.get("DANA_TOKEN_AUDIT_PROJECT_ID", "")
DANA_TIMEOUT_SECONDS = int(os.environ.get("DANA_TIMEOUT_SECONDS", "20"))
DANA_CONVERSATION_DEBUG = os.environ.get("DANA_CONVERSATION_DEBUG", "0")
LAMBDA_NAME = os.environ.get("AWS_LAMBDA_FUNCTION_NAME", "Portal_auto")

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

QUOTE_DEFAULTS = {
    "product": "auto_policy",
}

SUPPORTED_ACTIONS = {"extract_vehicle_document", "request_vehicle_policy_quote"}

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


def parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    raw_body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw_body = base64.b64decode(raw_body).decode("utf-8")
    return json.loads(raw_body)


def http_method(event: Dict[str, Any]) -> str:
    return event.get("httpMethod") or event.get("requestContext", {}).get("http", {}).get("method", "POST")


def normalize_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


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
    return document.get("fileName") or document.get("filename") or ""


def content_type_of(document: Dict[str, Any]) -> str:
    return document.get("contentType") or document.get("content_type") or ""


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


def bedrock_image_format(document: Dict[str, Any]) -> str:
    ext = extension_of(filename_of(document))
    return "png" if ext == "png" else "jpeg"


def validate_document(document: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    filename = filename_of(document)
    if not filename:
        errors.append("fileName es requerido.")
    if not document.get("content_base64"):
        errors.append("content_base64 es requerido.")
    if filename and not is_pdf_document(document) and not is_image_document(document):
        errors.append("El documento debe ser PDF, PNG o JPG.")
    return errors


def decode_document(document: Dict[str, Any]) -> bytes:
    try:
        return base64.b64decode(document.get("content_base64") or "")
    except Exception as exc:
        raise ValueError("content_base64 inválido.") from exc


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
    }


def build_quote_request(extraction: Dict[str, Any]) -> Dict[str, Any]:
    vehicle = extraction.get("vehicle") or {}
    return {
        "action": "request_vehicle_policy_quote",
        "applicant": {
            "identity": vehicle.get("ownerId"),
            "name": vehicle.get("ownerName"),
        },
        "vehicle": public_vehicle_payload(vehicle),
        "quote": QUOTE_DEFAULTS,
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
        "quoteRequest": build_quote_request(extraction),
    }


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
Eres un extractor documental para seguros de autos en Venezuela.
Analiza el documento adjunto. Puede ser:
- Certificado de origen / certificado de registro / título de propiedad del vehículo.
- Carnet o certificado de circulación del INTT.

Devuelve exclusivamente JSON válido. No uses markdown ni explicaciones.
No inventes datos. Si un campo no aparece claramente, usa null.

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
  "messages": []
}}

Reglas de identificación:
- document_type = "certificate_of_origin" si el documento principal es certificado de origen, certificado de registro, título o propiedad del vehículo.
- document_type = "circulation_card" si el documento principal es carnet o certificado de circulación del INTT.
- Si el archivo contiene varias secciones y una de ellas es certificado de registro, título, propiedad o certificado de origen, clasifica el documento principal como "certificate_of_origin", aunque también aparezcan menciones a circulación.
- En certificado de origen puede no existir placa; eso no invalida el documento.
- En carnet de circulación, placa y vin son campos críticos.

Reglas de extracción:
- ownerId: cédula/RIF del titular si aparece. Ejemplo del carnet: V24657722.
- ownerName: nombre completo del titular si aparece. Ejemplo: MARIA MILAGROS LASTRA PEREZ.
- plate: valor junto a "Placa". Ejemplo: AA635EE.
- vin: valor junto a Serial N.I.V., NIV, VIN, serial carrocería o chasis. Ejemplo: KNABA24337T371160.
- engineSerial: serial de motor si aparece claramente.
- brand: marca del vehículo. Ejemplo: KIA.
- model: modelo/versión. Ejemplo: PICANTO EX.
- year: año del vehículo. Ejemplo: 2007.
- color: color visible. Ejemplo: AZUL.
- vehicleClass: clase/tipo. Ejemplo: SEDAN.
- useType: uso. Ejemplo: PARTICULAR.
- weightKg: peso en kg si aparece, sin texto adicional. Ejemplo: 400.
- axles: número de ejes si aparece. Ejemplo: 2.
- seats: puestos si aparece. Ejemplo: 5.

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
        "missing_fields": missing_fields_for(vehicle),
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


def extract_from_ocr_fallback(document: Dict[str, Any], ocr_text: str) -> Dict[str, Any]:
    document_type = detect_document_type(document, ocr_text)
    upper = ocr_text.upper()
    lines = [line.strip() for line in upper.splitlines() if line.strip()]
    joined = " ".join(lines)

    vehicle = empty_vehicle(document_type)
    vehicle.update(
        {
            "plate": normalize_plate((re.search(r"PLACA\s*[:.]?\s*([A-Z0-9]{6,7})", joined) or [None, None])[1]),
            "vin": normalize_vin((re.search(r"(?:SERIAL\s*N\.?I\.?V\.?|VIN|NIV|CHASIS)\s*[:.]?\s*([A-Z0-9]{12,20})", joined) or [None, None])[1]),
            "year": normalize_year(joined),
            "ownerId": normalize_id((re.search(r"\b[VEJG]?\d{6,10}\b", joined) or [None])[0]),
            "brand": normalize_upper((re.search(r"\b(KIA|CHEVROLET|TOYOTA|FORD|HYUNDAI|MAZDA|RENAULT|NISSAN)\b", joined) or [None, None])[1]),
            "model": normalize_upper((re.search(r"\b(PICANTO\s*EX|COROLLA|ONIX|AVEO|FIESTA|ELANTRA)\b", joined) or [None, None])[1]),
            "color": normalize_upper((re.search(r"\b(AZUL|BLANCO|NEGRO|GRIS|PLATA|ROJO|VERDE)\b", joined) or [None, None])[1]),
            "vehicleClass": normalize_upper((re.search(r"\b(SEDAN|CAMIONETA|AUTOMOVIL|MOTO|PICKUP)\b", joined) or [None, None])[1]),
            "useType": normalize_upper((re.search(r"\b(PARTICULAR|COMERCIAL|CARGA)\b", joined) or [None, None])[1]),
            "weightKg": normalize_text((re.search(r"\b(\d{3,5})\s*KGS?\b", joined) or [None, None])[1]),
            "axles": normalize_text((re.search(r"\b(\d+)\s*EJES?\b", joined) or [None, None])[1]),
            "seats": normalize_text((re.search(r"\b(\d+)\s*PTOS?\b", joined) or [None, None])[1]),
        }
    )

    return {
        "document_valid": document_type != "unknown",
        "document_type": document_type,
        "extraction_source": "textract_fallback",
        "confidence": 0.45,
        "vehicle": vehicle,
        "missing_fields": missing_fields_for(vehicle),
        "messages": ["Extracción heurística usando texto OCR. Revisar campos antes de continuar."],
        "ocr_text": ocr_text,
    }


def handle_extract_vehicle_document(body: Dict[str, Any]) -> Dict[str, Any]:
    document = body.get("document") or {}
    if not isinstance(document, dict):
        return response(400, {"ok": False, "message": "document debe ser un objeto."})

    errors = validate_document(document)
    if errors:
        return response(400, {"ok": False, "message": "Documento inválido.", "errors": errors})

    file_bytes = decode_document(document)

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
        return response(200, build_public_extraction_response(document, extraction))
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
        if ocr_text:
            fallback_extraction = extract_from_ocr_fallback(document, ocr_text)
            if is_invalid_or_illegible(fallback_extraction):
                return invalid_document_response(fallback_extraction)
            return response(
                200,
                build_public_extraction_response(document, fallback_extraction),
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
    method = http_method(event)

    if method == "OPTIONS":
        return response(200, {"ok": True})
    if method != "POST":
        return response(405, {"ok": False, "message": "Method not allowed."})

    try:
        body = parse_body(event)
    except json.JSONDecodeError:
        return response(400, {"ok": False, "message": "Body JSON inválido."})

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
