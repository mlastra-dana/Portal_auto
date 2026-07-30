import base64
import json
import logging
import os
import re
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

QUOTE_DEFAULTS = {
    "product": "auto_policy",
}

SUPPORTED_ACTIONS = {"extract_vehicle_document", "request_vehicle_policy_quote"}


def response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, ensure_ascii=False),
    }


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
    explicit_filename = document.get("fileName") or document.get("filename")
    if explicit_filename:
        return explicit_filename

    try:
        _, key = s3_location_of(document)
    except ValueError:
        return ""
    return urllib.parse.unquote(key.rsplit("/", 1)[-1]) if key else ""


def content_type_of(document: Dict[str, Any]) -> str:
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


def bedrock_image_format(document: Dict[str, Any]) -> str:
    ext = extension_of(filename_of(document))
    return "png" if ext == "png" else "jpeg"


def validate_document(document: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    filename = filename_of(document)
    if not filename:
        errors.append("fileName es requerido cuando no puede inferirse desde S3.")

    source = document_source_of(document)
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
    if not has_base64 and not has_s3_reference:
        errors.append("Debe enviarse document.source, content_base64 o una referencia S3.")
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
    }


def build_demo_extraction_response(extraction: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "ok": True,
        "action": "extract_vehicle_document",
        "extraction": extraction,
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
    return response(422, {
        "ok": False,
        "message": "Documento inválido o ilegible. Por favor carga un certificado de origen o carnet de circulación válido y legible.",
        "extraction": extraction,
    })


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


def extract_with_bedrock(file_bytes: bytes, document: Dict[str, Any], ocr_text: Optional[str]) -> Dict[str, Any]:
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
    raw_text = read_bedrock_text(result)
    logger.info("Respuesta Bedrock raw=%s", raw_text)
    return normalize_bedrock_extraction(safe_json_loads(raw_text), document, ocr_text)


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

    ocr_text: Optional[str] = None
    try:
        ocr_text = extract_text_from_textract(file_bytes, document)
    except (ClientError, BotoCoreError, ValueError) as exc:
        logger.warning("Textract no pudo extraer texto auxiliar: %s", exc)
        ocr_text = None

    try:
        extraction = extract_with_bedrock(file_bytes, document, ocr_text)
        if is_invalid_or_illegible(extraction):
            return invalid_document_response(extraction)
        return response(200, build_demo_extraction_response(extraction))
    except Exception as exc:
        logger.exception("No se pudo extraer con Bedrock")
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
