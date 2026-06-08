type DocumentType = 'invoice' | 'certificate_of_origin' | 'photo_plate' | 'photo_serial';

interface ValidationResult {
  invoice_document_valid: boolean;
  certificate_document_valid: boolean;
  photo_plate_valid: boolean;
  photo_serial_valid: boolean;
  plate_match: boolean;
  serial_match: boolean;
  overall_status: 'validated' | 'with_observations' | 'manual_review';
  messages: string[];
}

interface IncomingDocument {
  type: DocumentType;
  fileName: string | null;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'OPTIONS,POST'
};

const expectedHints: Record<DocumentType, string[]> = {
  invoice: ['factura', 'invoice', 'compra'],
  certificate_of_origin: ['origen', 'certificate', 'certificado'],
  photo_plate: ['placa', 'plate', 'fotoplaca'],
  photo_serial: ['serial', 'vin', 'fotoserial']
};

const successResult: ValidationResult = {
  invoice_document_valid: true,
  certificate_document_valid: true,
  photo_plate_valid: true,
  photo_serial_valid: true,
  plate_match: true,
  serial_match: true,
  overall_status: 'validated',
  messages: [
    'La factura corresponde al tipo documental esperado.',
    'El certificado de origen corresponde al tipo documental esperado.',
    'La placa coincide entre documentos e imagen.',
    'El serial coincide entre documentos e imagen.'
  ]
};

const mismatchResult: ValidationResult = {
  invoice_document_valid: true,
  certificate_document_valid: true,
  photo_plate_valid: true,
  photo_serial_valid: true,
  plate_match: false,
  serial_match: true,
  overall_status: 'with_observations',
  messages: [
    'Se detectó discrepancia de placa entre la fotoplaca y la factura.',
    'El serial se mantiene consistente en los documentos cargados.',
    'Se recomienda revisión operativa antes de continuar.'
  ]
};

const manualReviewResult: ValidationResult = {
  invoice_document_valid: false,
  certificate_document_valid: true,
  photo_plate_valid: false,
  photo_serial_valid: true,
  plate_match: false,
  serial_match: false,
  overall_status: 'manual_review',
  messages: [
    'La factura no coincide con el tipo documental esperado.',
    'La fotoplaca no permite una lectura confiable de caracteres.',
    'No hay consistencia suficiente para validación automática.',
    'El expediente fue derivado a revisión manual.'
  ]
};

const normalize = (value: string) => value.toLowerCase().trim();

const hasExpectedHint = (name: string, hints: string[]) => {
  const normalizedName = normalize(name);
  return hints.some((hint) => normalizedName.includes(hint));
};

const asFunctionUrlEvent = (event: unknown) =>
  event as { requestContext?: { http?: { method?: string } }; body?: string | null };

export const handler = async (event: unknown): Promise<LambdaResponse> => {
  try {
    const functionUrlEvent = asFunctionUrlEvent(event);
    const method = functionUrlEvent.requestContext?.http?.method;

    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true })
      };
    }

    const parsedBody = functionUrlEvent.body ? JSON.parse(functionUrlEvent.body) : {};
    const documents = (parsedBody.documents ?? []) as IncomingDocument[];

    if (!Array.isArray(documents) || documents.length !== 4) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: false,
          message: 'Se esperaban 4 documentos para validar el expediente.'
        })
      };
    }

    const filenames = documents.map((doc) => normalize(doc.fileName ?? ''));

    let result: ValidationResult;
    if (filenames.some((name) => name.includes('manual') || name.includes('ilegible'))) {
      result = manualReviewResult;
    } else if (filenames.some((name) => name.includes('error') || name.includes('mismatch'))) {
      result = mismatchResult;
    } else {
      const byType = Object.fromEntries(documents.map((doc) => [doc.type, doc])) as Record<
        DocumentType,
        IncomingDocument
      >;

      const typedChecks = {
        invoice_document_valid: Boolean(
          byType.invoice?.fileName && hasExpectedHint(byType.invoice.fileName, expectedHints.invoice)
        ),
        certificate_document_valid: Boolean(
          byType.certificate_of_origin?.fileName &&
            hasExpectedHint(byType.certificate_of_origin.fileName, expectedHints.certificate_of_origin)
        ),
        photo_plate_valid: Boolean(
          byType.photo_plate?.fileName &&
            hasExpectedHint(byType.photo_plate.fileName, expectedHints.photo_plate)
        ),
        photo_serial_valid: Boolean(
          byType.photo_serial?.fileName &&
            hasExpectedHint(byType.photo_serial.fileName, expectedHints.photo_serial)
        )
      };

      result = Object.values(typedChecks).every(Boolean)
        ? successResult
        : {
            ...manualReviewResult,
            ...typedChecks,
            messages: [
              'Uno o más archivos no parecen corresponder al tipo documental esperado.',
              'Verifique nombres y contenido antes de reenviar el expediente.'
            ]
          };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: true,
        result,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error no controlado';
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: false,
        message: 'Falló la validación del expediente en Lambda.',
        error: message
      })
    };
  }
};
