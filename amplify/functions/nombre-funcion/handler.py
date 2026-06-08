import base64
import json
import logging
import os
import re
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, Optional, Tuple

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "")
DOCUMENTS_BUCKET_NAME = os.environ.get("DOCUMENTS_BUCKET_NAME", "")
EXTRACTIONS_BUCKET_NAME = os.environ.get("EXTRACTIONS_BUCKET_NAME", DOCUMENTS_BUCKET_NAME)
SLOT_VALIDATION_MAX_WORKERS = int(os.environ.get("SLOT_VALIDATION_MAX_WORKERS", "4"))
BEDROCK_MAX_TOKENS = int(os.environ.get("BEDROCK_MAX_TOKENS", "260"))

if not BEDROCK_MODEL_ID:
    logger.warning("BEDROCK_MODEL_ID no está definido en variables de entorno.")

# Para modelos Claude 3.7 / 4 AWS recomienda aumentar read_timeout bastante.
# Dejamos 300s como valor inicial razonable para demo.
bedrock = boto3.client(
    "bedrock-runtime",
    region_name=AWS_REGION,
    config=Config(read_timeout=300, connect_timeout=10, retries={"max_attempts": 2}),
)
s3 = boto3.client("s3", region_name=AWS_REGION)
textract = boto3.client(
    "textract",
    region_name=AWS_REGION,
    config=Config(read_timeout=60, connect_timeout=10, retries={"max_attempts": 2}),
)


def response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
        },
        "body": json.dumps(body, ensure_ascii=False),
    }


def sanitize_filename(filename: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]", "_", filename.strip())
    return cleaned or "documento"


def sanitize_key_fragment(value: Optional[str]) -> str:
    if not value:
        return "sin_valor"
    cleaned = re.sub(r"[^a-zA-Z0-9._-]", "_", value.strip())
    return cleaned or "sin_valor"


def persist_json_artifact(key: str, payload: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """
    Guarda JSON en S3 sin bloquear la validación si falla.
    """
    if not EXTRACTIONS_BUCKET_NAME:
        return None
    try:
        s3.put_object(
            Bucket=EXTRACTIONS_BUCKET_NAME,
            Key=key,
            Body=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json",
        )
        return {"bucket": EXTRACTIONS_BUCKET_NAME, "key": key}
    except Exception:
        logger.exception("No se pudo persistir artefacto JSON en S3. key=%s", key)
        return None


def build_frontend_required(extractions: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {
        slot: {
            "document_valid": bool(data.get("document_valid")),
            "plate": normalize_plate(data.get("plate")),
            "serial": normalize_serial(data.get("serial")),
            "reason": data.get("reason"),
        }
        for slot, data in extractions.items()
    }


def create_upload_url(slot: str, filename: str, content_type: str) -> Dict[str, Any]:
    if not DOCUMENTS_BUCKET_NAME:
        return response(
            500,
            {
                "success": False,
                "message": "DOCUMENTS_BUCKET_NAME no está configurado.",
            },
        )

    safe_name = sanitize_filename(filename)
    key = f"expedientes/{slot}/{uuid.uuid4().hex}_{safe_name}"
    try:
        upload_url = s3.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": DOCUMENTS_BUCKET_NAME,
                "Key": key,
                "ContentType": content_type or "application/octet-stream",
            },
            ExpiresIn=900,
        )
    except (ClientError, BotoCoreError) as exc:
        logger.exception("No se pudo crear URL presignada")
        return response(
            500,
            {
                "success": False,
                "message": f"No se pudo generar URL de carga: {str(exc)}",
            },
        )

    return response(
        200,
        {
            "success": True,
            "bucket": DOCUMENTS_BUCKET_NAME,
            "key": key,
            "upload_url": upload_url,
            "expires_in": 900,
        },
    )


def get_document_bytes(filename: str, document: Dict[str, Any]) -> bytes:
    content_base64 = document.get("content_base64")
    if content_base64:
        return base64.b64decode(content_base64)

    s3_key = document.get("s3_key")
    s3_bucket = document.get("s3_bucket") or DOCUMENTS_BUCKET_NAME
    if s3_key and s3_bucket:
        obj = s3.get_object(Bucket=s3_bucket, Key=s3_key)
        return obj["Body"].read()

    raise ValueError(f"No se recibió contenido ni referencia S3 para {filename}")


def get_extension(filename: str) -> str:
    if "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower().strip()


def normalize_image_format(ext: str) -> str:
    if ext == "jpg":
        return "jpeg"
    return ext


def normalize_plate(value: Optional[str]) -> Optional[str]:
    if not value or not isinstance(value, str):
        return None
    cleaned = re.sub(r"\s+", "", value).upper().strip()
    # placas venezolanas típicamente 6-7 alfanuméricos
    if re.fullmatch(r"[A-Z0-9]{6,7}", cleaned):
        return cleaned
    return cleaned if cleaned else None


def normalize_serial(value: Optional[str]) -> Optional[str]:
    if not value or not isinstance(value, str):
        return None
    cleaned = re.sub(r"[^A-Z0-9]", "", value.upper())
    return cleaned or None


def levenshtein_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)

    prev = list(range(len(b) + 1))
    curr = [0] * (len(b) + 1)

    for i, ca in enumerate(a, start=1):
        curr[0] = i
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
        prev, curr = curr, prev
    return prev[len(b)]


def should_snap_serial_to_reference(extracted: Optional[str], reference: Optional[str]) -> bool:
    ex = normalize_serial(extracted)
    ref = normalize_serial(reference)
    if not ex or not ref:
        return False
    if len(ex) != 17 or len(ref) != 17:
        return False
    if not is_vin_like(ex) or not is_vin_like(ref):
        return False
    if ex[:3] != ref[:3]:
        return False
    if ex[-4:] != ref[-4:]:
        return False
    return levenshtein_distance(ex, ref) <= 2


def normalize_text(value: Optional[str]) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value).strip()


def extract_vin_candidates(text: Optional[str]) -> list[str]:
    normalized = normalize_text(text).upper()
    if not normalized:
        return []
    return re.findall(r"\b[A-HJ-NPR-Z0-9]{17}\b", normalized)


VIN_TRANSLITERATION = {
    "A": 1,
    "B": 2,
    "C": 3,
    "D": 4,
    "E": 5,
    "F": 6,
    "G": 7,
    "H": 8,
    "J": 1,
    "K": 2,
    "L": 3,
    "M": 4,
    "N": 5,
    "P": 7,
    "R": 9,
    "S": 2,
    "T": 3,
    "U": 4,
    "V": 5,
    "W": 6,
    "X": 7,
    "Y": 8,
    "Z": 9,
}
VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
VIN_REGEX = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")


def is_valid_vin(vin: Optional[str]) -> bool:
    if not vin or not isinstance(vin, str):
        return False
    normalized = normalize_serial(vin)
    if not normalized or not VIN_REGEX.fullmatch(normalized):
        return False

    total = 0
    for index, char in enumerate(normalized):
        if char.isdigit():
            value = int(char)
        else:
            value = VIN_TRANSLITERATION.get(char)
            if value is None:
                return False
        total += value * VIN_WEIGHTS[index]

    check_digit = "X" if (total % 11) == 10 else str(total % 11)
    return normalized[8] == check_digit


def is_vin_like(vin: Optional[str]) -> bool:
    if not vin or not isinstance(vin, str):
        return False
    normalized = normalize_serial(vin)
    if not normalized:
        return False
    return bool(VIN_REGEX.fullmatch(normalized))


def get_block_text(block: Dict[str, Any], block_map: Dict[str, Dict[str, Any]]) -> str:
    words: list[str] = []
    for rel in block.get("Relationships", []):
        if rel.get("Type") != "CHILD":
            continue
        for child_id in rel.get("Ids", []):
            child = block_map.get(child_id)
            if not child:
                continue
            child_type = child.get("BlockType")
            if child_type == "WORD":
                text = child.get("Text")
                if text:
                    words.append(text)
            elif child_type == "SELECTION_ELEMENT" and child.get("SelectionStatus") == "SELECTED":
                words.append("X")
    return normalize_text(" ".join(words))


def extract_plate_candidates(text: Optional[str]) -> list[str]:
    upper = normalize_text(text).upper()
    if not upper:
        return []
    return re.findall(r"(?<![A-Z0-9])[A-Z0-9]{6,7}(?![A-Z0-9])", upper)


def analyze_textract_document(file_bytes: bytes) -> Dict[str, Any]:
    return textract.analyze_document(
        Document={"Bytes": file_bytes},
        FeatureTypes=["TABLES", "FORMS"],
    )


def extract_document_fields_from_textract(blocks: list[Dict[str, Any]]) -> Dict[str, Optional[str]]:
    result: Dict[str, Optional[str]] = {"plate": None, "serial": None}
    block_map = {b.get("Id"): b for b in blocks if b.get("Id")}

    # 1) Extraer de tablas (prioritario)
    for table in [b for b in blocks if b.get("BlockType") == "TABLE"]:
        child_ids: list[str] = []
        for rel in table.get("Relationships", []):
            if rel.get("Type") == "CHILD":
                child_ids.extend(rel.get("Ids", []))
        cells = [block_map.get(cid) for cid in child_ids]
        cells = [c for c in cells if c and c.get("BlockType") == "CELL"]
        if not cells:
            continue

        rows: Dict[int, Dict[int, str]] = {}
        for cell in cells:
            row_idx = int(cell.get("RowIndex", 0))
            col_idx = int(cell.get("ColumnIndex", 0))
            if row_idx <= 0 or col_idx <= 0:
                continue
            rows.setdefault(row_idx, {})[col_idx] = get_block_text(cell, block_map)
        if not rows:
            continue

        header_idx = min(rows.keys())
        header = rows.get(header_idx, {})
        vin_col = None
        plate_col = None
        for col_idx, label in header.items():
            upper = normalize_text(label).upper()
            if "VIN" in upper:
                vin_col = col_idx
            if "PLACA" in upper:
                plate_col = col_idx

        if vin_col is None and plate_col is None:
            continue

        for row_idx in sorted(rows.keys()):
            if row_idx <= header_idx:
                continue
            row = rows[row_idx]

            if vin_col is not None and not result["serial"]:
                vin_cell = row.get(vin_col)
                candidates = extract_vin_candidates(vin_cell)
                valid = next((c for c in candidates if is_valid_vin(c)), None)
                if valid:
                    result["serial"] = normalize_serial(valid)
                else:
                    vin_like = next((c for c in candidates if is_vin_like(c)), None)
                    if vin_like:
                        result["serial"] = normalize_serial(vin_like)

            if plate_col is not None and not result["plate"]:
                plate_cell = row.get(plate_col)
                plate = normalize_plate(plate_cell)
                if plate:
                    result["plate"] = plate

            if result["serial"] and result["plate"]:
                return result

    # 2) Fallback en líneas con palabras clave
    lines = [normalize_text(b.get("Text")) for b in blocks if b.get("BlockType") == "LINE"]
    for line in lines:
        upper = line.upper()
        if not result["serial"] and ("VIN" in upper or "CHASIS" in upper or "SERIAL" in upper):
            candidates = extract_vin_candidates(line)
            valid = next((c for c in candidates if is_valid_vin(c)), None)
            if valid:
                result["serial"] = normalize_serial(valid)
            else:
                vin_like = next((c for c in candidates if is_vin_like(c)), None)
                if vin_like:
                    result["serial"] = normalize_serial(vin_like)
        if not result["plate"] and "PLACA" in upper:
            plates = extract_plate_candidates(line)
            plate = normalize_plate(plates[0]) if plates else None
            if plate:
                result["plate"] = plate
        if result["serial"] and result["plate"]:
            break

    return result


def infer_document_valid_from_lines(slot: str, lines: list[str]) -> bool:
    joined = " ".join(lines).upper()
    if slot == "invoice":
        return "FACTURA" in joined
    if slot == "certificate_of_origin":
        return ("CERTIFICADO" in joined and "ORIGEN" in joined) or "CERTIFICATE OF ORIGIN" in joined
    return False


def extract_document_with_textract(slot: str, filename: str, document: Dict[str, Any]) -> Dict[str, Any]:
    try:
        file_bytes = get_document_bytes(filename, document)
        resp = analyze_textract_document(file_bytes)
        blocks = resp.get("Blocks", [])
        lines = [normalize_text(b.get("Text")) for b in blocks if b.get("BlockType") == "LINE"]
        document_valid = infer_document_valid_from_lines(slot, lines)
        fields = extract_document_fields_from_textract(blocks)
    except Exception as exc:
        logger.warning("Error Textract slot=%s: %s", slot, exc)
        # Fallback para no bloquear flujo cuando Textract no soporta el archivo
        # (por ejemplo PDFs comprimidos con codificación no compatible).
        fallback = invoke_bedrock_json_extractor(
            slot=slot,
            filename=filename,
            document=document,
        )
        if bool(fallback.get("document_valid")):
            fallback["reason"] = "Documento válido (fallback por formato no soportado en Textract)"
        else:
            fallback_reason = normalize_text(str(fallback.get("reason") or ""))
            fallback_reason_lower = fallback_reason.lower()
            # Si el fallback ya determinó tipo documental inválido, preservamos ese mensaje de negocio.
            if (
                "no corresponde" in fallback_reason_lower
                or "tipo documental inválido" in fallback_reason_lower
                or "serial no legible" in fallback_reason_lower
            ):
                fallback["reason"] = fallback_reason
            else:
                fallback["reason"] = "No se pudo procesar documento automáticamente (formato no soportado en Textract)"
        return fallback

    plate = fields.get("plate")
    serial = fields.get("serial")

    # Refuerzo para facturas:
    # si Textract no logra extraer serial/placa o falla tipo documental,
    # intentamos complementar con Bedrock usando el prompt especializado.
    if slot == "invoice" and (not serial or not plate or not document_valid):
        bedrock_result = invoke_bedrock_json_extractor(
            slot=slot,
            filename=filename,
            document=document,
        )
        bedrock_plate = normalize_plate(bedrock_result.get("plate"))
        bedrock_serial = normalize_serial(bedrock_result.get("serial"))
        bedrock_valid = bool(bedrock_result.get("document_valid"))

        if not plate and bedrock_plate:
            plate = bedrock_plate
        if not serial and bedrock_serial:
            serial = bedrock_serial
        if not document_valid and bedrock_valid:
            document_valid = True

    if slot == "invoice":
        if not document_valid:
            reason = "No corresponde a una factura"
        elif serial:
            reason = "Factura válida"
        else:
            reason = "Factura válida sin serial (valor VIN visible pero no confiable para extracción automática)"
    else:
        if not document_valid:
            reason = "No corresponde a un certificado de origen"
        elif serial:
            reason = "Certificado válido"
        else:
            reason = "Certificado válido sin serial"

    return {
        "document_valid": document_valid,
        "plate": plate,
        "serial": serial,
        "reason": reason,
    }


def sanitize_slot_result(slot: str, result: Dict[str, Any], reference_serial: Optional[str] = None) -> Dict[str, Any]:
    normalized_result = {
        "document_valid": bool(result.get("document_valid")),
        "plate": normalize_plate(result.get("plate")),
        "serial": normalize_serial(result.get("serial")),
        "reason": result.get("reason"),
    }

    # Regla de negocio: en factura NO se muestra serial dudoso.
    # Si no es VIN válido (incluyendo dígito verificador), se devuelve null.
    if slot == "invoice":
        invoice_serial = normalized_result.get("serial")
        if not is_valid_vin(invoice_serial):
            if is_vin_like(invoice_serial):
                if normalized_result["document_valid"]:
                    normalized_result["reason"] = "Factura válida con serial VIN-like (posible ruido OCR)"
            else:
                normalized_result["serial"] = None
                if normalized_result["document_valid"]:
                    normalized_result["reason"] = "Factura válida sin serial (valor VIN visible pero no confiable para extracción automática)"

    # Misma regla conservadora para fotoserial: no mostrar serial dudoso.
    if slot == "photo_serial":
        photo_serial = normalized_result.get("serial")
        reference = normalize_serial(reference_serial)

        if should_snap_serial_to_reference(photo_serial, reference):
            normalized_result["serial"] = reference
            if normalized_result["document_valid"]:
                normalized_result["reason"] = "Fotoserial válido"

        photo_serial = normalized_result.get("serial")
        if not is_valid_vin(photo_serial):
            normalized_result["serial"] = None
            if normalized_result["document_valid"]:
                normalized_result["reason"] = "Serial no legible con suficiente confianza"

    return normalized_result


def safe_json_loads(raw: str) -> Dict[str, Any]:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Intento de rescate si el modelo devolvió texto adicional
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def extract_text_from_bedrock_response(resp: Dict[str, Any]) -> str:
    """
    Extrae el texto concatenado de output.message.content[*].text
    """
    try:
        content_blocks = resp["output"]["message"]["content"]
        texts = [block["text"] for block in content_blocks if "text" in block]
        return "\n".join(texts).strip()
    except Exception as exc:
        raise ValueError(f"No se pudo leer la respuesta de Bedrock: {exc}") from exc


def make_user_message(
    slot: str, filename: str, file_bytes: bytes, reference_serial: Optional[str] = None
) -> Dict[str, Any]:
    """
    Construye el bloque de mensaje para Converse.
    - Para PDF: usa document + text
    - Para imagen: usa image + text
    """
    ext = get_extension(filename)
    normalized_reference = normalize_serial(reference_serial)
    reference_hint = (
        f" Serial de referencia para validar lectura: {normalized_reference}."
        if slot == "photo_serial" and normalized_reference
        else ""
    )

    if ext in {"pdf"}:
        return {
            "role": "user",
            "content": [
                {
                    "text": f"Analiza este documento para el slot '{slot}' y responde según las instrucciones.{reference_hint}"
                },
                {
                    "document": {
                        "format": "pdf",
                        "name": "documento",
                        "source": {"bytes": file_bytes},
                    }
                },
            ],
        }

    if ext in {"png", "jpg", "jpeg", "webp", "gif"}:
        return {
            "role": "user",
            "content": [
                {
                    "text": f"Analiza esta imagen para el slot '{slot}' y responde según las instrucciones.{reference_hint}"
                },
                {
                    "image": {
                        "format": normalize_image_format(ext),
                        "source": {"bytes": file_bytes},
                    }
                },
            ],
        }

    raise ValueError(f"Extensión no soportada para {filename}: {ext}")


def invoke_bedrock_json_extractor(
    slot: str, filename: str, document: Dict[str, Any], reference_serial: Optional[str] = None
) -> Dict[str, Any]:
    """
    Invoca Bedrock para un slot específico y espera un JSON estricto.
    """
    file_bytes = get_document_bytes(filename, document)
    user_message = make_user_message(slot, filename, file_bytes, reference_serial=reference_serial)

    system_prompt = build_system_prompt(slot)

    try:
        resp = bedrock.converse(
            modelId=BEDROCK_MODEL_ID,
            system=[{"text": system_prompt}],
            messages=[user_message],
            inferenceConfig={
                "temperature": 0,
                "maxTokens": BEDROCK_MAX_TOKENS,
                "topP": 0.1,
            },
        )
        raw_text = extract_text_from_bedrock_response(resp)
        logger.info("Respuesta Bedrock slot=%s raw=%s", slot, raw_text)
        return safe_json_loads(raw_text)
    except (ClientError, BotoCoreError, ValueError, json.JSONDecodeError) as exc:
        logger.exception("Error invocando Bedrock para slot=%s", slot)
        return {
            "document_valid": False,
            "plate": None,
            "serial": None,
            "reason": f"Error procesando documento: {str(exc)}",
        }


def build_system_prompt(slot: str) -> str:
    if slot == "invoice":
        return """
Analiza la factura proporcionada y extrae únicamente la información visible en el documento.

Responde exclusivamente con JSON válido.
No agregues explicaciones.
No agregues texto antes ni después del JSON.
No uses markdown.
No inventes datos.
Si un campo no aparece claramente en el documento, devuelve null.

Debes devolver exactamente este esquema:
{
  "document_valid": false,
  "plate": null,
  "serial": null,
  "reason": null
}

Reglas generales de normalización:
- Todos los campos de texto deben devolverse sin espacios al inicio o al final.
- Si un texto contiene múltiples espacios internos consecutivos, colapsarlos a un solo espacio.
- Los valores null deben devolverse como JSON null.
- No inventes códigos ni formatos no visibles en el documento.

Reglas de extracción:
- document_valid:
  Debe ser true solo si el archivo corresponde claramente a una factura.
  Si no corresponde, devolver false.

- plate:
  Extraer la placa solo si aparece explícitamente y claramente asociada al vehículo.
  Priorizar etiquetas cercanas como: "PLACA", "PLACA VEHÍCULO", "PLACA DEL VEHÍCULO".
  Si no aparece claramente, devolver null.

- serial:
  Extraer solo serial del vehículo (VIN, N° CHASIS, SERIAL MOTOR, SERIAL CARROCERÍA).
  Si existe VIN, usarlo de preferencia como serial.
  Aceptar serial solo cuando esté asociado a etiquetas de identificación vehicular.
  Si el documento tiene tabla con columnas "VIN" y "Motor", el serial debe salir de la columna "VIN" de la línea del producto.
  Nunca usar la columna "Motor" como serial cuando exista "VIN".
  En facturas con cabecera de detalle tipo "Ref.Fab | Descripción | Cant | UM | VIN | Motor ...":
  leer únicamente el valor de la celda bajo "VIN" en la misma fila del producto.
  No concatenar texto de celdas vecinas ni tomar texto fuera de esa columna.
  Si el valor VIN no tiene 17 caracteres alfanuméricos claros, devolver serial = null.
  Si el VIN no pasa validación de dígito verificador (ISO 3779, posición 9), mantenerlo igual si es claramente legible
  (puede haber ruido OCR en un carácter).
  Si no hay etiqueta clara de vehículo, devolver serial = null.

Reglas de descarte:
- Ignorar datos administrativos de factura: RIF/VAT, nombre, dirección, moneda, número de control (nro_ctrl),
  número de factura (supplier_invoice_number), códigos de producto (product_id), cantidades/precios y líneas de detalle.
- Nunca usar como serial campos administrativos aunque parezcan alfanuméricos.
- No confundir serial/VIN con número de factura, control interno, referencia comercial o código de cliente.
- Ignorar textos de marca de agua/fondo y artefactos OCR fuera de la tabla de detalle.
- Manejar ambigüedades OCR frecuentes: 0/O, 1/I, 5/S, 8/B, 6/G, 2/Z.

reason:
- Debe ser una frase corta y operativa, por ejemplo:
  - "Factura válida"
  - "No corresponde a una factura"
  - "Factura válida sin placa"
  - "Factura válida sin serial"

Devuelve únicamente el JSON final.
""".strip()

    if slot == "certificate_of_origin":
        return """
Analiza el documento logístico proporcionado y extrae únicamente la información visible en el documento.

Responde exclusivamente con JSON válido.
No agregues explicaciones.
No agregues texto antes ni después del JSON.
No uses markdown.
No inventes datos.
Si un campo no aparece claramente en el documento, devuelve null.

Debes devolver exactamente este esquema:
{
  "document_valid": false,
  "plate": null,
  "serial": null,
  "reason": null
}

Reglas generales de normalización:
- Todos los campos de texto deben devolverse sin espacios al inicio o al final.
- Si un texto contiene múltiples espacios internos consecutivos, colapsarlos a un solo espacio.
- Los valores null deben devolverse como JSON null.
- No inventes códigos ni formatos no visibles en el documento.
- El certificado de origen es la referencia principal del expediente para placa/serial.

Reglas de extracción:
- document_valid:
  Debe ser true solo si el archivo corresponde claramente a un certificado de origen.
  Si no corresponde, devolver false.

- plate:
  Extraer la placa solo si aparece explícitamente y claramente asociada al vehículo.
  Priorizar etiquetas como: "PLACA", "PLACA DEL VEHÍCULO", "IDENTIFICACIÓN VEHÍCULO".
  Si no aparece claramente, devolver null.

- serial:
  Extraer el serial del vehículo (VIN, N° CHASIS, SERIAL MOTOR, SERIAL CARROCERÍA) solo si aparece explícitamente.
  Priorizar VIN cuando esté presente.
  Si no aparece claramente, devolver null.

Reglas de descarte:
- Ignorar números administrativos: acta, consecutivo, control, póliza, RIF, referencia, orden interna.
- No confundir serial/VIN con números de factura, pedido o códigos comerciales.
- Si hay múltiples candidatos, elegir el más consistente con etiquetas de identificación del vehículo.
- Manejar ambigüedades OCR frecuentes: 0/O, 1/I, 5/S, 8/B, 6/G, 2/Z.

reason:
- Debe ser una frase corta y operativa, por ejemplo:
  - "Certificado válido"
  - "No corresponde a un certificado de origen"
  - "Certificado válido sin placa"
  - "Certificado válido sin serial"

Devuelve únicamente el JSON final.
""".strip()

    if slot == "photo_plate":
        return """
Eres un validador documental de motocicletas.

Tu tarea es validar si la imagen cargada corresponde a una FOTOGRAFÍA DE PLACA y extraer únicamente la placa visible.

Responde exclusivamente con JSON válido.
No agregues explicaciones.
No agregues texto antes ni después del JSON.
No uses markdown.
No inventes datos.

Debes devolver exactamente este esquema:
{
  "document_valid": false,
  "plate": null,
  "serial": null,
  "reason": null
}

Reglas:
- document_valid debe ser true solo si la imagen corresponde claramente a una foto donde se vea una placa de motocicleta o vehículo.
- plate: extraer solo la placa visible.
- serial debe ser null en este tipo de documento.
- No confundas placa con VIN, serial de motor, serial de carrocería u otros identificadores.
- Si no se ve una placa clara, document_valid = false.
- reason debe contener una frase corta:
  - "Fotoplaca válida"
  - "No corresponde a una fotoplaca"
  - "Placa no legible"

La placa debe devolverse en MAYÚSCULAS.
""".strip()

    if slot == "photo_serial":
        return """
Eres un validador documental de motocicletas.

Tu tarea es validar si la imagen cargada corresponde a una FOTOGRAFÍA DE SERIAL y extraer únicamente el serial visible.

Responde exclusivamente con JSON válido.
No agregues explicaciones.
No agregues texto antes ni después del JSON.
No uses markdown.
No inventes datos.

Debes devolver exactamente este esquema:
{
  "document_valid": false,
  "plate": null,
  "serial": null,
  "reason": null
}

Reglas:
- document_valid debe ser true solo si la imagen corresponde claramente a una foto de serial de motor, serial de carrocería, serial de chasis o VIN.
- serial: extraer únicamente el serial visible grabado en la pieza del chasis/motor (texto estampado o grabado).
- plate debe ser null en este tipo de documento.
- Prioriza serial de 17 caracteres tipo VIN cuando esté presente.
- Lee el serial carácter por carácter en el orden exacto (sin inventar ni completar).
- Ignora texto de etiquetas adhesivas, códigos de barras, números de lote, referencias de fábrica y cualquier texto impreso en mangueras/cables.
- Ignora texto parcial borroso o tapado por dedos/cables.
- Si hay más de un candidato, elige el que esté físicamente grabado en metal/chasis y no el de stickers.
- Si no puedes leer el serial completo con alta confianza, devuelve serial = null y document_valid = false.
- Si no se ve un serial claro, document_valid = false.
- reason debe contener una frase corta:
  - "Fotoserial válido"
  - "No corresponde a un fotoserial"
  - "Serial no legible"

El serial debe devolverse como texto limpio.
""".strip()

    raise ValueError(f"Slot no soportado: {slot}")


def compare_values(a: Optional[str], b: Optional[str], mode: str) -> Optional[bool]:
    """
    Devuelve:
    - True si ambos existen y coinciden
    - False si ambos existen y no coinciden
    - None si alguno falta
    """
    if not a or not b:
        return None

    if mode == "plate":
        return normalize_plate(a) == normalize_plate(b)
    if mode == "serial":
        return normalize_serial(a) == normalize_serial(b)

    return None


def aggregate_match(*values: Optional[bool]) -> Optional[bool]:
    """
    Si hay un False => False
    Si todos los no-null son True y hay al menos uno => True
    Si no hay suficientes datos => None
    """
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    if any(v is False for v in vals):
        return False
    return True


def process_slot(slot: str, doc: Dict[str, Any], reference_serial: Optional[str] = None) -> Tuple[str, Dict[str, Any]]:
    filename = doc.get("filename")
    has_base64 = bool(doc.get("content_base64"))
    has_s3_ref = bool(doc.get("s3_key"))

    if not filename or (not has_base64 and not has_s3_ref):
        return (
            slot,
            {
                "document_valid": False,
                "plate": None,
                "serial": None,
                "reason": "Documento no suministrado correctamente",
            },
        )

    if slot == "invoice":
        result = extract_document_with_textract(
            slot=slot,
            filename=filename,
            document=doc,
        )
    else:
        result = invoke_bedrock_json_extractor(
            slot=slot,
            filename=filename,
            document=doc,
            reference_serial=reference_serial,
        )
    return slot, sanitize_slot_result(slot, result, reference_serial=reference_serial)


def handle_validate_slot(body: Dict[str, Any]) -> Dict[str, Any]:
    slot = body.get("slot")
    document = body.get("document") or {}
    expedient_id = body.get("expedient_id") or "sin_expediente"
    reference_serial = body.get("reference_serial")

    valid_slots = {"invoice", "certificate_of_origin", "photo_plate", "photo_serial"}
    if slot not in valid_slots:
        return response(400, {"success": False, "message": "slot inválido"})

    slot_name, result = process_slot(slot, document, reference_serial=reference_serial)
    artifact_key = (
        f"extractions/{sanitize_key_fragment(str(expedient_id))}/slots/"
        f"{sanitize_key_fragment(slot_name)}_{uuid.uuid4().hex}.json"
    )
    persisted = persist_json_artifact(
        artifact_key,
        {
            "expedient_id": expedient_id,
            "slot": slot_name,
            "result": result,
        },
    )
    return response(
        200,
        {
            "success": True,
            "slot": slot_name,
            "result": result,
            "frontend_required": {
                slot_name: {
                    "document_valid": bool(result.get("document_valid")),
                    "plate": normalize_plate(result.get("plate")),
                    "serial": normalize_serial(result.get("serial")),
                    "reason": result.get("reason"),
                }
            },
            "persisted_extraction": persisted,
        },
    )


def lambda_handler(event, context):
    # Preflight CORS
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return {
            "statusCode": 200,
            "body": "",
        }

    if event.get("requestContext", {}).get("http", {}).get("method") != "POST":
        return response(405, {"success": False, "message": "Method not allowed"})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return response(400, {"success": False, "message": "Body JSON inválido"})

    action = body.get("action")
    if action == "create_upload_url":
        slot = body.get("slot") or "general"
        filename = body.get("filename") or ""
        content_type = body.get("content_type") or "application/octet-stream"
        if not filename:
            return response(400, {"success": False, "message": "filename es requerido"})
        return create_upload_url(slot=slot, filename=filename, content_type=content_type)
    if action == "validate_slot":
        return handle_validate_slot(body)

    documents = body.get("documents") or {}
    expedient_id = body.get("expedient_id")

    required_slots = ["invoice", "certificate_of_origin", "photo_plate", "photo_serial"]
    missing_slots = [slot for slot in required_slots if slot not in documents]
    if missing_slots:
        return response(
            400,
            {
                "success": False,
                "message": "Faltan documentos requeridos",
                "missing_slots": missing_slots,
            },
        )

    extraction_results: Dict[str, Dict[str, Any]] = {}

    max_workers = max(1, min(SLOT_VALIDATION_MAX_WORKERS, len(required_slots)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_by_slot = {
            executor.submit(process_slot, slot, documents.get(slot) or {}): slot
            for slot in required_slots
        }
        for future in as_completed(future_by_slot):
            slot = future_by_slot[future]
            try:
                resolved_slot, result = future.result()
                extraction_results[resolved_slot] = result
            except Exception as exc:
                logger.exception("Error en procesamiento paralelo para slot=%s", slot)
                extraction_results[slot] = {
                    "document_valid": False,
                    "plate": None,
                    "serial": None,
                    "reason": f"Error procesando documento: {str(exc)}",
                }

    # Normalizar valores extraídos
    invoice_plate = normalize_plate(extraction_results["invoice"].get("plate"))
    cert_plate = normalize_plate(extraction_results["certificate_of_origin"].get("plate"))
    photo_plate = normalize_plate(extraction_results["photo_plate"].get("plate"))

    invoice_serial = normalize_serial(extraction_results["invoice"].get("serial"))
    cert_serial = normalize_serial(extraction_results["certificate_of_origin"].get("serial"))
    photo_serial = normalize_serial(extraction_results["photo_serial"].get("serial"))

    # Ajuste guiado por referencia: si el fotoserial es muy cercano al serial del certificado,
    # preferimos el valor de referencia para reducir errores OCR de 1-2 caracteres.
    if should_snap_serial_to_reference(photo_serial, cert_serial):
        extraction_results["photo_serial"]["serial"] = cert_serial
        if extraction_results["photo_serial"].get("document_valid"):
            extraction_results["photo_serial"]["reason"] = "Fotoserial válido"
        photo_serial = cert_serial

    # Validaciones de tipo documental
    invoice_valid = bool(extraction_results["invoice"].get("document_valid"))
    certificate_valid = bool(extraction_results["certificate_of_origin"].get("document_valid"))
    photo_plate_valid = bool(extraction_results["photo_plate"].get("document_valid"))
    photo_serial_valid = bool(extraction_results["photo_serial"].get("document_valid"))

    # Comparaciones
    plate_match = aggregate_match(
        compare_values(invoice_plate, cert_plate, "plate"),
        compare_values(invoice_plate, photo_plate, "plate"),
        compare_values(cert_plate, photo_plate, "plate"),
    )

    serial_match = aggregate_match(
        compare_values(invoice_serial, cert_serial, "serial"),
        compare_values(invoice_serial, photo_serial, "serial"),
        compare_values(cert_serial, photo_serial, "serial"),
    )

    same_expedient = (
        invoice_valid
        and certificate_valid
        and photo_plate_valid
        and photo_serial_valid
        and plate_match is True
        and serial_match is True
    )

    messages = []

    # Mensajes por tipo
    for slot, label in [
        ("invoice", "La factura"),
        ("certificate_of_origin", "El certificado de origen"),
        ("photo_plate", "La fotoplaca"),
        ("photo_serial", "El fotoserial"),
    ]:
        if extraction_results[slot].get("document_valid"):
            messages.append(f"{label} corresponde al tipo documental esperado.")
        else:
            reason = extraction_results[slot].get("reason") or "Tipo documental inválido."
            messages.append(f"{label}: {reason}")

    # Mensajes de coincidencia
    if plate_match is True:
        messages.append("La placa coincide entre documentos e imagen.")
    elif plate_match is False:
        messages.append("La placa no coincide entre los documentos e imagen.")
    else:
        messages.append("No hubo suficientes datos para validar la placa en todas las fuentes.")

    if serial_match is True:
        messages.append("El serial coincide entre documentos e imagen.")
    elif serial_match is False:
        messages.append("El serial no coincide entre los documentos e imagen.")
    else:
        messages.append("No hubo suficientes datos para validar el serial en todas las fuentes.")

    overall_status = "validated" if same_expedient else "manual_review"

    frontend_required = build_frontend_required(extraction_results)
    persisted_extractions: Dict[str, Dict[str, str]] = {}
    for slot in required_slots:
        key = (
            f"extractions/{sanitize_key_fragment(str(expedient_id or 'sin_expediente'))}/slots/"
            f"{sanitize_key_fragment(slot)}_{uuid.uuid4().hex}.json"
        )
        persisted = persist_json_artifact(
            key,
            {
                "expedient_id": expedient_id,
                "slot": slot,
                "result": extraction_results.get(slot),
            },
        )
        if persisted:
            persisted_extractions[slot] = persisted

    summary_key = (
        f"extractions/{sanitize_key_fragment(str(expedient_id or 'sin_expediente'))}/"
        f"summary_{uuid.uuid4().hex}.json"
    )
    persisted_summary = persist_json_artifact(
        summary_key,
        {
            "expedient_id": expedient_id,
            "frontend_required": frontend_required,
            "document_validation": {
                "invoice_valid": invoice_valid,
                "certificate_of_origin_valid": certificate_valid,
                "photo_plate_valid": photo_plate_valid,
                "photo_serial_valid": photo_serial_valid,
            },
            "extracted_data": {
                "invoice_plate": invoice_plate,
                "certificate_plate": cert_plate,
                "photo_plate": photo_plate,
                "invoice_serial": invoice_serial,
                "certificate_serial": cert_serial,
                "photo_serial": photo_serial,
            },
            "cross_validation": {
                "plate_match": plate_match,
                "serial_match": serial_match,
                "same_expedient": same_expedient,
            },
            "overall_status": overall_status,
            "messages": messages,
        },
    )

    result = {
        "success": True,
        "expedient_id": expedient_id,
        "document_validation": {
            "invoice_valid": invoice_valid,
            "certificate_of_origin_valid": certificate_valid,
            "photo_plate_valid": photo_plate_valid,
            "photo_serial_valid": photo_serial_valid,
        },
        "extracted_data": {
            "invoice_plate": invoice_plate,
            "certificate_plate": cert_plate,
            "photo_plate": photo_plate,
            "invoice_serial": invoice_serial,
            "certificate_serial": cert_serial,
            "photo_serial": photo_serial,
        },
        "cross_validation": {
            "plate_match": plate_match,
            "serial_match": serial_match,
            "same_expedient": same_expedient,
        },
        "overall_status": overall_status,
        "messages": messages,
        "raw_extractions": extraction_results,
        "frontend_required": frontend_required,
        "persisted_extractions": persisted_extractions,
        "persisted_summary": persisted_summary,
    }

    return response(200, result)
