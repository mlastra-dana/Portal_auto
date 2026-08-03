# DanaConnect Vehicle Document API

API para validar documentos vehiculares y devolver los datos extraídos del vehículo.

## Endpoint

```http
POST https://7tve2roaxc.execute-api.us-east-1.amazonaws.com/danaconnect/vehicle-document
```

## Autenticación

El endpoint requiere API key en el header:

```http
x-api-key: API_KEY_ENTREGADA_POR_DANACONNECT
```

## Headers

```http
Content-Type: application/json
x-api-key: API_KEY_ENTREGADA_POR_DANACONNECT
```

## Request

El endpoint valida y extrae información desde documentos enviados por JSON.
No recibe `multipart/form-data` y no ejecuta API Upload de DANA en esta versión.

### Opción A: documento en Base64

```json
{
  "action": "extract_vehicle_document",
  "document": {
    "fileName": "carnet.pdf",
    "contentType": "application/pdf",
    "source": "BASE64_DEL_ARCHIVO"
  }
}
```

### Opción B: documento por referencia S3

```json
{
  "action": "extract_vehicle_document",
  "document": {
    "fileName": "carnet.pdf",
    "contentType": "application/pdf",
    "source": "s3://WS/2026/7/documento.pdf"
  }
}
```

Nota operativa: el bucket confirmado para este flujo es
`mercantilseguros-dana` y la ruta del documento debe ubicarse bajo el prefijo
`WS/`. También se acepta la forma completa
`s3://mercantilseguros-dana/WS/2026/7/documento.pdf`.

También se mantiene compatibilidad con `content_base64`, `s3_uri`,
`s3_bucket` + `s3_key`.

Si se usa una referencia S3, el cliente solo debe enviar la ruta del documento.
La lectura del objeto, credenciales y permisos son gestionados internamente por
el servicio.

Formatos soportados:

| Tipo de archivo | Content-Type |
| --- | --- |
| PDF | `application/pdf` |
| PNG | `image/png` |
| JPG/JPEG | `image/jpeg` |

## Documentos Aceptados

| Documento | Valor en response |
| --- | --- |
| Carnet / certificado de circulación | `circulation_card` |
| Título / certificado de origen / certificado de registro vehicular | `certificate_of_origin` |

El documento debe ser legible. Se rechazan imágenes o PDFs borrosos,
recortados, oscuros, con reflejos, con baja resolución o con campos críticos no
legibles.

## Response Exitoso

```http
200 OK
```

La API solo devuelve datos extraídos del documento. Si un dato no aparece con
claridad, el campo se devuelve como `null` y puede aparecer en `missingFields`.
No se completan campos por inferencia, valores esperados o conocimiento externo.

```json
{
  "ok": true,
  "document": {
    "valid": true,
    "type": "circulation_card",
    "label": "Carnet de circulación",
    "fileName": "carnet.pdf",
    "confidence": 95,
    "missingFields": [],
    "messages": []
  },
  "vehicle": {
    "documentType": "circulation_card",
    "ownerId": "V24657722",
    "ownerName": "MARIA MILAGROS LASTRA PEREZ",
    "plate": "AA635EE",
    "vin": "KNABA24337T371160",
    "engineSerial": "G4HG6187613",
    "brand": "KIA",
    "model": "PICANTO EX",
    "year": "2007",
    "color": "AZUL",
    "vehicleClass": "AUTOMOVIL SEDAN",
    "useType": "PARTICULAR",
    "weightKg": "400",
    "axles": "2",
    "seats": "5"
  }
}
```

## Errores

### API key ausente o inválida

```http
403 Forbidden
```

```json
{
  "message": "Forbidden"
}
```

### Request inválido

```http
400 Bad Request
```

```json
{
  "ok": false,
  "message": "Documento inválido.",
  "errors": [
    "fileName es requerido cuando no puede inferirse desde S3.",
    "Debe enviarse document.source, content_base64 o una referencia S3."
  ]
}
```

### Documento inválido o ilegible

```http
422 Unprocessable Entity
```

```json
{
  "ok": false,
  "message": "Documento inválido o ilegible. Por favor carga un certificado de origen o carnet de circulación válido y legible.",
  "document": {
    "valid": false,
    "type": "unknown",
    "label": "Documento no reconocido",
    "confidence": 35,
    "missingFields": [],
    "messages": []
  }
}
```

## Ejemplo Curl

```bash
curl --location 'https://7tve2roaxc.execute-api.us-east-1.amazonaws.com/danaconnect/vehicle-document' \
  --header 'Content-Type: application/json' \
  --header 'x-api-key: API_KEY_ENTREGADA_POR_DANACONNECT' \
  --data '{
    "action": "extract_vehicle_document",
    "document": {
      "fileName": "carnet.pdf",
      "contentType": "application/pdf",
      "source": "s3://WS/2026/7/documento.pdf"
    }
  }'
```
