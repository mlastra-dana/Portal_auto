# Portal Auto - API de documentos vehiculares

Este repositorio conserva el frontend historico del portal, pero el flujo actual
de entrega se centra en exponer una API backend-to-backend para validar
documentos vehiculares y devolver los datos extraidos del vehiculo.

## Estado actual de la API

### Endpoint productivo

```http
POST https://7tve2roaxc.execute-api.us-east-1.amazonaws.com/danaconnect/vehicle-document
```

### Componentes AWS

| Recurso | Nombre / valor |
| --- | --- |
| Region | `us-east-1` / United States (N. Virginia) |
| Lambda productiva | `Portal_auto` |
| Lambda demo | `Portal_auto_demo` |
| Function URL demo | `https://paa6quj6f4pjywpih25da2qm6i0wujof.lambda-url.us-east-1.on.aws/` |
| API Gateway | `danaconnect-vehicle-document-api` |
| API Gateway ID | `7tve2roaxc` |
| Stage | `danaconnect` |
| Resource path | `/vehicle-document` |
| Method | `POST` |
| Authorization | `NONE` |
| API key required | `true` |
| API key | `MS-vehicle-document-prod-key` |
| API key ID | `ikaci1uthe` |
| Usage plan | `danaconnect-vehicle-document-prod-plan` |
| Usage plan ID | `rbj7v6` |

### Seguridad

El API esta protegido mediante API Gateway REST API con API key. El consumidor
debe enviar el header:

```http
x-api-key: API_KEY_ENTREGADA_POR_DANACONNECT
```

La API key no debe documentarse con su valor real dentro del repositorio. Debe
entregarse al cliente por un canal seguro.

La Lambda productiva `Portal_auto` debe quedar accesible desde API Gateway. La
Function URL directa de esta Lambda debe deshabilitarse cuando el demo este
apuntando a `Portal_auto_demo`.

La Lambda `Portal_auto_demo` existe para el demo comercial y se consume desde:

```http
POST https://paa6quj6f4pjywpih25da2qm6i0wujof.lambda-url.us-east-1.on.aws/
```

Usa extraccion real con Bedrock/Textract, pero conserva el response historico
esperado por el frontend demo:

```json
{
  "ok": true,
  "action": "extract_vehicle_document",
  "extraction": {
    "document_valid": true,
    "document_type": "certificate_of_origin",
    "vehicle": {}
  }
}
```

### Contrato de entrada

El endpoint productivo soporta consumo backend-to-backend por JSON:

- **Referencia S3:** el consumidor envia la ruta S3 del documento ya cargado.
- **Base64:** el consumidor envia el contenido del archivo codificado en Base64.

JSON/Base64:


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

JSON/S3:

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

El bucket confirmado para este flujo es `mercantilseguros-dana`; desde el
contrato del cliente basta con enviar la ruta del archivo. El acceso al bucket,
las credenciales y Secrets Manager son detalles internos de la Lambda.

Se mantiene compatibilidad interna con `content_base64`, `s3_uri`,
`s3_bucket` + `s3_key`.

La API no recibe `multipart/form-data` en esta version y no ejecuta API Upload
de DANA. El servicio solo valida el documento y devuelve la extraccion.

Formatos soportados:

- `application/pdf`
- `image/png`
- `image/jpeg`

Documentos aceptados:

- Carnet / certificado de circulacion (`circulation_card`)
- Titulo / certificado de origen / certificado de registro vehicular (`certificate_of_origin`)

### Contrato de salida

La respuesta exitosa devuelve:

- `document`: validez, tipo detectado y metadatos minimos del documento.
- `vehicle`: datos extraidos del vehiculo.

El response no devuelve la extraccion OCR/IA completa para mantener el contrato
compacto para el cliente.
Los datos del vehiculo deben provenir del documento. Si un campo no aparece con
claridad, se devuelve `null`; no se completan valores por inferencia.

Los documentos de baja calidad, borrosos, recortados, con reflejos o con campos
criticos no legibles se rechazan como `422 Unprocessable Entity`.

### Operacion interna

La lectura de documentos desde S3 se realiza con credenciales almacenadas en AWS
Secrets Manager y obtenidas mediante la capa `AWS-Parameters-and-Secrets-Lambda-Extension`.
Esto es transparente para el cliente.

Variables relevantes para operacion:

| Variable | Uso |
| --- | --- |
| `BEDROCK_MODEL_ID` | Modelo Bedrock usado para analizar el documento. |
| `BEDROCK_MAX_TOKENS` | Limite maximo de tokens de salida de Bedrock. |
| `BEDROCK_MIN_CONFIDENCE` | Umbral minimo de confianza para aceptar un documento. Por defecto `0.75`. |
| `DANA_S3_SECRET_ID` | Secret con credenciales de lectura S3. |
| `DANA_TOKEN_AUDIT_PROJECT_ID` | Proyecto DANA donde se registran tokens de consumo IA. |

El secret S3 debe contener `Access key ID`, `Secret access key` y `Region`. La
Lambda normaliza `us-east-01` a `us-east-1`, pero el valor correcto esperado es
`us-east-1`.

### Notas operativas

- API Gateway REST API tiene timeout maximo de 29 segundos para integraciones Lambda.
- En pruebas con documento real, el flujo completo respondio en aproximadamente 17 segundos.
- Si el procesamiento supera 29 segundos, habria que evaluar un flujo asincrono.
- El usage plan no tiene cuota ni throttling configurado actualmente.
- El metodo `POST` ya exige API key; una llamada sin `x-api-key` responde `403 Forbidden`.
- Una llamada con API key valida y body incompleto llega a Lambda y responde validacion `400`.
- El frontend demo no debe apuntar a `Portal_auto`, porque esa Lambda devuelve el contrato productivo `document` + `vehicle`.
- El frontend demo debe apuntar a la Function URL de `Portal_auto_demo`.

### Documentacion de entrega

- Documentacion tecnica corta para cliente: [`docs/api-vehicle-document.md`](docs/api-vehicle-document.md)
- Version PDF para compartir: [`docs/api-vehicle-document.pdf`](docs/api-vehicle-document.pdf)

### Pendientes funcionales

- Redeployar Lambda despues de cambios en `amplify/functions/nombre-funcion/handler.py`.
- Reprobar con carnet de circulacion y certificado de origen para confirmar el contrato `document` + `vehicle`.

---

# Example Company - Autogestion Vehicular

Aplicacion web construida con React + Vite + TypeScript + TailwindCSS para registrar informacion de vehiculos orientada a seguros de autos.

## Caracteristicas

- Identidad visual Example Company desde `src/brand/Marca_example`.
- Inicio del flujo por cedula o RIF.
- Portal de autogestion en `/validation`.
- Carga de un documento vehicular:
  - Certificado de origen
  - Carnet de circulacion
- Deteccion simulada del tipo documental.
- Extraccion simulada de datos del vehiculo:
  - titular
  - placa
  - VIN / serial de carroceria
  - serial de motor
  - marca, modelo, ano, color y uso
- Revision editable antes del envio.
- Envio demo de payload estructurado a DANAConnect por consola.
- Preparado para despliegue SPA en AWS Amplify.

## Stack

- React 18
- Vite
- TypeScript
- TailwindCSS
- React Router DOM

## Infraestructura AWS

El portal utiliza una arquitectura serverless en AWS para alojar la aplicacion y
procesar documentos vehiculares mediante OCR e inteligencia artificial.

### Arquitectura

```text
Usuario
   |
   v
AWS Amplify Hosting
Frontend React
   |
   v
Lambda Function URL
Endpoint publico HTTPS
   |
   v
AWS Lambda
Procesamiento del documento
   |
   +-- Amazon Textract
   |   OCR de imagenes PNG y JPG
   |
   +-- Amazon Bedrock
       Anthropic Claude Sonnet 4.6
       Analisis y extraccion estructurada
   |
   v
Amazon CloudWatch Logs
Monitoreo y registros
```

### Servicios utilizados

| Servicio AWS | Funcion |
| --- | --- |
| AWS Amplify Hosting | Construccion, despliegue y alojamiento del frontend React. |
| AWS Lambda | Recepcion, validacion y procesamiento de documentos. |
| Lambda Function URL | Endpoint HTTPS publico utilizado por el frontend. |
| Amazon Textract | Extraccion OCR auxiliar para imagenes PNG y JPG. |
| Amazon Bedrock | Analisis documental con Anthropic Claude Sonnet 4.6 y generacion de datos estructurados del vehiculo. |
| DANAconnect Start Conversation | Registro de consumo de tokens en la lista central `Bedrock_logs` de Mercantil Seguros. |
| Amazon CloudWatch Logs | Registro de ejecuciones, respuestas y errores de Lambda. |
| AWS IAM | Administracion de los permisos requeridos por Lambda. |
| AWS CloudFormation | Aprovisionamiento de la infraestructura administrada mediante Amplify. |

### Flujo de procesamiento

1. El usuario carga un certificado de origen o carnet de circulacion.
2. El frontend convierte el archivo a Base64 y lo envia por HTTPS.
3. AWS Lambda valida y procesa la solicitud.
4. Para imagenes, Amazon Textract ejecuta el OCR auxiliar.
5. Amazon Bedrock utiliza Claude Sonnet 4.6 para analizar el documento.
6. Lambda toma el `usage` de Bedrock y, si está configurado, registra tokens en `Bedrock_logs`.
7. Lambda devuelve al portal los datos estructurados del vehiculo.
8. CloudWatch registra la ejecucion y los posibles errores.

### Auditoria central de tokens

La Lambda puede registrar cada invocacion a Bedrock en la lista DANA `Bedrock_logs`, compartida con otros procesos de Mercantil Seguros.

Variables requeridas para activar la auditoria:

```text
DANA_TOKEN_AUDIT_PROJECT_ID=203347
DANA_BASE_URL=https://appserv.danaconnect.com
DANA_TOKEN_URL=https://auth.danaconnect.com/oauth2/token
DANA_CLIENT_ID=
DANA_CLIENT_SECRET=
DANA_OAUTH_SCOPE=conversation:access2api
```

Variables opcionales:

```text
DANA_ACCESS_TOKEN=
DANA_OAUTH_AUTH_METHOD=basic
DANA_TIMEOUT_SECONDS=20
DANA_CONVERSATION_DEBUG=0
```

Campos enviados a `Bedrock_logs`:

```text
LAMBDA_NAME
MODEL_ID
NOMBRE_ARCHIVO_DOC
RESULTADO_VALIDOC
TOKENS_TOTALES
TOKEN_INPUT
TOKEN_OUTPUT
```

`LAMBDA_NAME` se toma automaticamente de `AWS_LAMBDA_FUNCTION_NAME`. Este proceso no envia `TOMADOR_ID` ni `DATA_ID` porque el log central se usa para auditoria de consumo, no para trazabilidad operativa granular de cada flujo.

El registro de auditoria no bloquea el endpoint. Si Start Conversation falla, queda un warning en CloudWatch y la API continua respondiendo al cliente.

### Consideraciones de costos

Los principales factores de consumo son:

- Amplify Hosting: minutos de compilacion, almacenamiento y transferencia.
- Lambda: cantidad de solicitudes, memoria y duracion de cada ejecucion.
- Textract: cantidad de imagenes o paginas procesadas.
- Bedrock con Claude Sonnet 4.6: volumen de entrada y tokens de salida.
- DANAconnect `Bedrock_logs`: registro central de consumo por Lambda, modelo y resultado.
- CloudWatch: volumen y tiempo de retencion de los logs.

## Desarrollo local

```bash
npm install
npm run dev
```

App disponible por defecto en `http://localhost:5173`.

## Build de produccion

```bash
npm run build
```

El output se genera en `dist/`.
