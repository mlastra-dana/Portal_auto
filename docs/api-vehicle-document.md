# DanaConnect Vehicle Document API

API para validar documentos vehiculares y devolver un JSON estructurado para solicitud de cotización.

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

El archivo debe enviarse codificado en Base64.

```json
{
  "document": {
    "fileName": "carnet.pdf",
    "contentType": "application/pdf",
    "content_base64": "BASE64_DEL_ARCHIVO"
  }
}
```

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
  "quoteRequest": {
    "action": "request_vehicle_policy_quote",
    "applicant": {
      "identity": "V24657722",
      "name": "MARIA MILAGROS LASTRA PEREZ"
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
      "useType": "PARTICULAR"
    },
    "quote": {
      "product": "auto_policy"
    }
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
    "fileName es requerido.",
    "content_base64 es requerido."
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
      "content_base64": "BASE64_DEL_ARCHIVO"
    }
  }'
```
