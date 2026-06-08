import { UploadedDocument, ValidationResult } from '../types/validation';
import { expectedDocumentTypeHints } from './documents';

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

const normalized = (value: string) => value.toLowerCase().trim();

const hasExpectedHint = (name: string, hints: string[]) => {
  const normalizedName = normalized(name);
  return hints.some((hint) => normalizedName.includes(hint));
};

export const runMockValidation = async (
  uploadedDocuments: UploadedDocument[]
): Promise<ValidationResult> => {
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const filenames = uploadedDocuments
    .map((doc) => doc.fileName || '')
    .map((name) => normalized(name));

  if (filenames.some((name) => name.includes('manual') || name.includes('ilegible'))) {
    return manualReviewResult;
  }

  if (filenames.some((name) => name.includes('error') || name.includes('mismatch'))) {
    return mismatchResult;
  }

  const invoice = uploadedDocuments.find((doc) => doc.type === 'invoice');
  const cert = uploadedDocuments.find((doc) => doc.type === 'certificate_of_origin');
  const plate = uploadedDocuments.find((doc) => doc.type === 'photo_plate');
  const serial = uploadedDocuments.find((doc) => doc.type === 'photo_serial');

  const typedChecks = {
    invoice_document_valid: Boolean(
      invoice?.fileName && hasExpectedHint(invoice.fileName, expectedDocumentTypeHints.invoice)
    ),
    certificate_document_valid: Boolean(
      cert?.fileName && hasExpectedHint(cert.fileName, expectedDocumentTypeHints.certificate_of_origin)
    ),
    photo_plate_valid: Boolean(
      plate?.fileName && hasExpectedHint(plate.fileName, expectedDocumentTypeHints.photo_plate)
    ),
    photo_serial_valid: Boolean(
      serial?.fileName && hasExpectedHint(serial.fileName, expectedDocumentTypeHints.photo_serial)
    )
  };

  if (Object.values(typedChecks).every(Boolean)) {
    return successResult;
  }

  return {
    ...manualReviewResult,
    ...typedChecks,
    messages: [
      'Uno o más archivos no parecen corresponder al tipo documental esperado.',
      'Verifica nombres y contenido antes de reenviar el expediente.'
    ]
  };
};
