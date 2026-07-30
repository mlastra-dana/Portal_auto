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

El documento puede enviarse de dos formas.

El archivo se envía dentro del campo `document.source`. Este campo admite dos
valores:

- contenido del archivo en Base64;
- referencia S3 del archivo ya cargado.

### Opción A: archivo en Base64

```json
{
  "document": {
    "fileName": "carnet.pdf",
    "contentType": "application/pdf",
    "source": "BASE64_DEL_ARCHIVO"
  }
}
```

### Opción B: referencia a S3

```json
{
  "document": {
    "fileName": "carnet.pdf",
    "contentType": "application/pdf",
    "source": "s3://mercantilseguros-dana/WS/2026/7/documento.pdf"
  }
}
```

Nota operativa: el bucket confirmado para este flujo es
`mercantilseguros-dana` y la ruta del documento debe ubicarse bajo el prefijo
`WS/`.

También se mantiene compatibilidad con `content_base64`, `s3_uri`,
`s3_bucket` + `s3_key` y `s3_url`, pero el contrato recomendado para nuevas
integraciones es `document.source`.

Si se usa una referencia S3, la Lambda debe tener permiso de lectura sobre el
objeto enviado.

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
    "document": {
      "fileName": "carnet.pdf",
      "contentType": "application/pdf",
      "source": "BASE64_DEL_ARCHIVO"
    }
  }'
```
