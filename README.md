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
| Amazon CloudWatch Logs | Registro de ejecuciones, respuestas y errores de Lambda. |
| AWS IAM | Administracion de los permisos requeridos por Lambda. |
| AWS CloudFormation | Aprovisionamiento de la infraestructura administrada mediante Amplify. |

### Flujo de procesamiento

1. El usuario carga un certificado de origen o carnet de circulacion.
2. El frontend convierte el archivo a Base64 y lo envia por HTTPS.
3. AWS Lambda valida y procesa la solicitud.
4. Para imagenes, Amazon Textract ejecuta el OCR auxiliar.
5. Amazon Bedrock utiliza Claude Sonnet 4.6 para analizar el documento.
6. Lambda devuelve al portal los datos estructurados del vehiculo.
7. CloudWatch registra la ejecucion y los posibles errores.

### Consideraciones de costos

Los principales factores de consumo son:

- Amplify Hosting: minutos de compilacion, almacenamiento y transferencia.
- Lambda: cantidad de solicitudes, memoria y duracion de cada ejecucion.
- Textract: cantidad de imagenes o paginas procesadas.
- Bedrock con Claude Sonnet 4.6: volumen de entrada y tokens de salida.
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
