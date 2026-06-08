import base64
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "")
BEDROCK_MAX_TOKENS = int(os.environ.get("BEDROCK_MAX_TOKENS", "1200"))

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
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
}


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
    if "CERTIFICADO DE CIRCULACION" in upper or "CERTIFICADO DE CIRCULACIÓN" in upper:
        return "circulation_card"
    if "CERTIFICADO DE ORIGEN" in upper:
        return "certificate_of_origin"
    if "CERTIFICADO DE REGISTRO DE VEHICULO" in upper or "CERTIFICADO DE REGISTRO DE VEHÍCULO" in upper:
        return "certificate_of_origin"
    if "TITULO" in upper or "TÍTULO" in upper:
        return "certificate_of_origin"
    return "unknown"


def detect_document_type(document: Dict[str, Any], text: Optional[str] = None) -> str:
    if text:
        detected = detect_document_type_from_text(text)
        if detected != "unknown":
            return detected

    filename = filename_of(document).lower()
    if "carnet" in filename or "circulacion" in filename or "circulation" in filename:
        return "circulation_card"
    if "certificado" in filename or "origen" in filename or "titulo" in filename or "title" in filename:
        return "certificate_of_origin"
    return "unknown"


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
- document_type = "circulation_card" si ves "CERTIFICADO DE CIRCULACIÓN" o carnet INTT.
- document_type = "certificate_of_origin" si ves certificado de origen, certificado de registro, título o propiedad del vehículo.
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
        extraction = extract_with_bedrock(file_bytes, document, ocr_text)
        return response(200, {"ok": True, "action": "extract_vehicle_document", "extraction": extraction})
    except Exception as exc:
        logger.exception("No se pudo extraer con Bedrock")
        if ocr_text:
            return response(
                200,
                {
                    "ok": True,
                    "action": "extract_vehicle_document",
                    "extraction": extract_from_ocr_fallback(document, ocr_text),
                    "warning": str(exc),
                },
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
    method = event.get("requestContext", {}).get("http", {}).get("method", "POST")

    if method == "OPTIONS":
        return response(200, {"ok": True})
    if method != "POST":
        return response(405, {"ok": False, "message": "Method not allowed."})

    try:
        body = parse_body(event)
    except json.JSONDecodeError:
        return response(400, {"ok": False, "message": "Body JSON inválido."})

    action = body.get("action") or "extract_vehicle_document"
    if action != "extract_vehicle_document":
        return response(
            400,
            {
                "ok": False,
                "message": "Acción no soportada por ahora.",
                "supported_actions": ["extract_vehicle_document"],
            },
        )

    return handle_extract_vehicle_document(body)
