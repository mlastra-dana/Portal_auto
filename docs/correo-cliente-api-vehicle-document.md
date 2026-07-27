# Asunto: Preguntas para validar flujo del API de documentos vehiculares

Hola Sarina,

Ya tenemos creado y probado el API Gateway para el endpoint de documentos vehiculares. El endpoint recibe un documento en Base64, valida si corresponde a un documento vehicular válido y devuelve un JSON estructurado para cotización.

Antes de cerrar la documentación final para el cliente, necesitamos validar con ellos estos puntos:

1. **Envío del documento**

   Confirmar si siempre enviarán el archivo en Base64 dentro del request.

   Formato propuesto:

   ```json
   {
     "document": {
       "fileName": "carnet.pdf",
       "contentType": "application/pdf",
       "content_base64": "BASE64_DEL_ARCHIVO"
     }
   }
   ```

2. **Documentos aceptados**

   Para este flujo, los únicos documentos admitidos serán:

   - Carnet / certificado de circulación
   - Título / certificado de origen / certificado de registro vehicular

3. **Response esperado**

   Confirmar si el response debe contener solo:

   - validez del documento;
   - tipo de documento detectado;
   - JSON estructurado para cotización.

   Es decir, no devolveríamos toda la extracción OCR/IA para mantener la respuesta más simple.

4. **Formato del JSON de cotización**

   Confirmar si el formato `quoteRequest` que estamos proponiendo les sirve, o si ellos tienen un esquema específico que debamos mapear.

   Dentro de `quoteRequest` incluimos un bloque `quote`, que por ahora solo identifica el producto a cotizar:

   ```json
   "quote": {
     "product": "auto_policy"
   }
   ```

   Este bloque no sale del documento. Es una estructura propuesta para indicar que el flujo corresponde a una cotización de póliza de auto. Debemos confirmar con el cliente si este bloque es necesario, si el valor `auto_policy` es correcto, o si ellos manejan otro esquema específico para producto/cobertura/frecuencia de pago.

5. **Responsabilidad del siguiente paso**

   Confirmar si nuestra API solo debe devolver el `quoteRequest`, o si además debemos enviarlo automáticamente a algún endpoint de ellos.

6. **Archivo original en el flujo posterior**

   Si debemos enviar información a un endpoint de ellos, confirmar si necesitan recibir solo los datos estructurados o también el archivo original en Base64.

7. **Tiempos de respuesta**

   Confirmar si les funciona un flujo síncrono con respuesta aproximada de 10 a 25 segundos. El timeout máximo actual del endpoint es de 29 segundos.

Con estas respuestas podemos cerrar el contrato final del API y dejar la documentación lista para entrega.

Saludos,

Maria
