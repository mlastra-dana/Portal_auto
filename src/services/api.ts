import { DocumentType, ValidationResult } from '../types/validation';
import { CompareExpedientResponse, SlotExtraction, ValidateDocumentsResponse, ValidateImagesResponse } from '../types/api';

const apiUrl = import.meta.env.VITE_API_URL;
const lambdaPublicUrl = import.meta.env.VITE_NOMBRE_FUNCION_LAMBDA_URL;
const networkTimeoutMs = Number(import.meta.env.VITE_NETWORK_TIMEOUT_MS ?? 30000);
const phaseTimeoutMs = Number(import.meta.env.VITE_LAMBDA_TIMEOUT_MS ?? 120000);
const fileReadTimeoutMs = Number(import.meta.env.VITE_FILE_READ_TIMEOUT_MS ?? 20000);

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string
) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(timeoutMessage);
    }
    if (error instanceof TypeError) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('No hay conexión a internet. Verifique su red e intente nuevamente.');
      }
      throw new Error('No se pudo conectar con el backend. Revise CORS, URL configurada y conectividad de red.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const httpStatusMessageMap: Record<number, string> = {
  400: 'Solicitud inválida. Revise los datos enviados.',
  401: 'No autorizado para ejecutar esta validación.',
  403: 'Acceso denegado por permisos o política de seguridad.',
  404: 'Servicio de validación no encontrado.',
  405: 'Método HTTP no permitido para este endpoint.',
  408: 'El backend tardó demasiado en responder.',
  413: 'El archivo es demasiado pesado para procesarlo. Comprime el PDF/imagen o usa un archivo más liviano.',
  415: 'Formato de archivo no soportado por el backend.',
  422: 'No se pudo procesar el documento. Verifique que el archivo corresponda al tipo esperado.',
  429: 'Demasiadas solicitudes. Intente nuevamente en unos segundos.',
  500: 'Error interno del backend al validar el archivo.',
  502: 'El backend no respondió correctamente.',
  503: 'El servicio de validación no está disponible temporalmente.',
  504: 'El backend excedió el tiempo de procesamiento.'
};

const getHttpErrorMessage = (status: number, backendMessage?: string | null) => {
  const fallback = httpStatusMessageMap[status] ?? `Error validando archivo (HTTP ${status}).`;
  if (!backendMessage || !backendMessage.trim()) return fallback;
  return `${fallback} ${backendMessage.trim()}`;
};

const isAbsoluteUrl = (value: string) => /^https?:\/\//i.test(value);

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, '');

const resolveApiUrl = () => {
  if (!apiUrl && !lambdaPublicUrl) {
    throw new Error('Faltan variables de entorno del backend (VITE_API_URL o VITE_NOMBRE_FUNCION_LAMBDA_URL).');
  }

  if (!apiUrl && lambdaPublicUrl) {
    return normalizeBaseUrl(lambdaPublicUrl);
  }

  if (apiUrl) {
    const cleanApiUrl = apiUrl.trim();
    if (isAbsoluteUrl(cleanApiUrl)) {
      return normalizeBaseUrl(cleanApiUrl);
    }

    // `/api` usa proxy de Vite; fuera de desarrollo no existe ese proxy.
    if (lambdaPublicUrl && !import.meta.env.DEV) {
      return normalizeBaseUrl(lambdaPublicUrl);
    }

    return cleanApiUrl;
  }

  throw new Error('Falta una URL válida para el backend.');
};

const normalizePlate = (value?: string | null) => (value ? value.replace(/\s+/g, '').toUpperCase().trim() : null);
const normalizeSerial = (value?: string | null) => (value ? value.replace(/[^A-Z0-9]/gi, '').toUpperCase().trim() : null);
const ocrEquivalentMap: Record<string, string> = {
  '0': 'O',
  O: '0',
  '1': 'I',
  I: '1',
  '2': 'Z',
  Z: '2',
  '5': 'S',
  S: '5',
  '6': 'G',
  G: '6',
  '8': 'B',
  B: '8'
};

const areEquivalentWithOcrNoise = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === right) continue;
    if (ocrEquivalentMap[left] === right || ocrEquivalentMap[right] === left) continue;
    return false;
  }
  return true;
};

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    const timeoutId = window.setTimeout(() => {
      reader.abort();
      reject(
        new Error(
          `La preparación del archivo "${file.name}" tardó demasiado. Intente nuevamente o use un archivo más liviano.`
        )
      );
    }, fileReadTimeoutMs);

    reader.onload = () => {
      window.clearTimeout(timeoutId);
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('No se pudo leer el archivo para validación.'));
        return;
      }
      const markerIndex = result.indexOf(',');
      resolve(markerIndex >= 0 ? result.slice(markerIndex + 1) : result);
    };
    reader.onerror = () => {
      window.clearTimeout(timeoutId);
      reject(new Error('No se pudo convertir el archivo a base64.'));
    };
    reader.onabort = () => {
      window.clearTimeout(timeoutId);
    };
    reader.readAsDataURL(file);
  });

const postDirect = async <TResponse>(payload: Record<string, unknown>, timeoutMs = networkTimeoutMs) => {
  const response = await fetchWithTimeout(
    resolveApiUrl(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    },
    timeoutMs,
    'Se agotó el tiempo en la validación del archivo.'
  );

  const rawBody = await response.text();
  let body: (TResponse & { success?: boolean; message?: string; error?: string }) | null = null;
  try {
    body = rawBody ? ((JSON.parse(rawBody) as TResponse & { success?: boolean; message?: string; error?: string }) ?? null) : null;
  } catch {
    body = null;
  }

  if (!response.ok || body?.success === false) {
    const baseMessage = getHttpErrorMessage(response.status, body?.message ?? null);
    const detail = body?.error ? ` Detalle: ${body.error}` : '';
    throw new Error(`${baseMessage}${detail}`);
  }
  return (body ?? ({} as TResponse)) as TResponse;
};

type DocumentSlot = Extract<DocumentType, 'invoice' | 'certificate_of_origin'>;
type ImageSlot = Extract<DocumentType, 'photo_plate' | 'photo_serial'>;

type SlotValidationPayload = {
  action: 'validate_slot';
  slot: DocumentType;
  expedient_id?: string;
  reference_serial?: string;
  document: {
    filename: string;
    content_base64: string;
    content_type: string;
  };
};

const slotExpectedMap: Record<DocumentType, string> = {
  invoice: 'INVOICE',
  certificate_of_origin: 'CERTIFICATE_OF_ORIGIN',
  photo_plate: 'PHOTO_PLATE',
  photo_serial: 'PHOTO_SERIAL'
};

const slotLabelMap: Record<DocumentType, string> = {
  invoice: 'Factura',
  certificate_of_origin: 'Certificado de origen',
  photo_plate: 'Fotoplaca',
  photo_serial: 'Fotoserial'
};

const extractPlateHintFromFilename = (filename?: string | null): string | null => {
  if (!filename) return null;
  const base = filename.toUpperCase().replace(/\.[A-Z0-9]+$/, '');
  const compact = base.replace(/[^A-Z0-9]/g, '');
  if (!compact) return null;

  // Busca placas candidatas de 6-7 caracteres alfanuméricos.
  const matches = compact.match(/[A-Z0-9]{6,7}/g);
  if (!matches || matches.length === 0) return null;

  const candidate = matches.find((value) => /[A-Z]/.test(value) && /\d/.test(value)) ?? matches[0];
  const normalized = normalizePlate(candidate);
  return normalized ?? null;
};

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // eliminación
        curr[j - 1] + 1, // inserción
        prev[j - 1] + cost // sustitución
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = curr[j];
    }
  }
  return prev[b.length];
};

const isLikelyPlateOcrVariant = (detected: string, hint: string): boolean => {
  if (detected.length !== hint.length) return false;
  if (detected.length < 6 || detected.length > 7) return false;
  if (detected.slice(0, 2) !== hint.slice(0, 2)) return false;
  if (detected.slice(-1) !== hint.slice(-1)) return false;
  return levenshteinDistance(detected, hint) <= 3;
};

const applyFilenamePlateHint = (slotResult: SlotExtraction, filename?: string | null): SlotExtraction => {
  const hintPlate = extractPlateHintFromFilename(filename);
  const detectedPlate = normalizePlate(slotResult.plate);
  if (!hintPlate || !detectedPlate || detectedPlate === hintPlate) return slotResult;
  if (!slotResult.document_valid) return slotResult;
  if (!isLikelyPlateOcrVariant(detectedPlate, hintPlate)) return slotResult;

  return {
    ...slotResult,
    plate: hintPlate
  };
};

const buildSlotPayload = async (
  slot: DocumentType,
  file: File,
  expedientId?: string,
  referenceSerial?: string
): Promise<SlotValidationPayload> => {
  const base64 = await toBase64(file);
  return {
    action: 'validate_slot',
    slot,
    expedient_id: expedientId,
    reference_serial: referenceSerial,
    document: {
      filename: file.name,
      content_base64: base64,
      content_type: file.type || 'application/octet-stream'
    }
  };
};

const mapSlotValidationToExtraction = (slot: DocumentType, response: Record<string, unknown>): SlotExtraction => {
  const plate = (response.plate as string | undefined) ?? null;
  const serial = (response.serial as string | undefined) ?? null;
  const docValid =
    typeof response.document_valid === 'boolean'
      ? response.document_valid
      : typeof response.isValidForSlot === 'boolean'
        ? response.isValidForSlot
        : typeof response.validationResult === 'string'
          ? response.validationResult === 'VALIDADA'
          : false;

  const reason =
    (response.reason as string | undefined) ||
    (response.slotValidationReason as string | undefined) ||
    (response.description as string | undefined) ||
    (response.message as string | undefined) ||
    `Validación ${slotExpectedMap[slot]}`;

  return {
    document_valid: Boolean(docValid),
    plate: plate ?? null,
    serial: serial ?? null,
    reason
  };
};

const validateSingleSlot = async (
  slot: DocumentType,
  file: File,
  expedientId?: string,
  options?: { referenceSerial?: string }
): Promise<SlotExtraction> => {
  try {
    const payload = await buildSlotPayload(slot, file, expedientId, options?.referenceSerial);
    const response = (await postDirect<Record<string, unknown>>(payload, phaseTimeoutMs)) as Record<string, unknown>;
    const frontendRequired =
      typeof response.frontend_required === 'object' && response.frontend_required !== null
        ? (response.frontend_required as Record<string, unknown>)
        : null;
    const frontendSlot =
      frontendRequired && typeof frontendRequired[slot] === 'object' && frontendRequired[slot] !== null
        ? (frontendRequired[slot] as Record<string, unknown>)
        : null;
    const nestedResult = frontendSlot
      ? frontendSlot
      : typeof response.result === 'object' && response.result !== null
        ? (response.result as Record<string, unknown>)
        : response;
    return mapSlotValidationToExtraction(slot, nestedResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    throw new Error(`${slotLabelMap[slot]}: ${message}`);
  }
};

const compareTwo = (a?: string | null, b?: string | null, mode: 'plate' | 'serial' = 'plate'): boolean | null => {
  if (!a || !b) return null;
  if (mode === 'plate') {
    const left = normalizePlate(a);
    const right = normalizePlate(b);
    if (!left || !right) return null;
    return areEquivalentWithOcrNoise(left, right);
  }
  const left = normalizeSerial(a);
  const right = normalizeSerial(b);
  if (!left || !right) return null;
  return areEquivalentWithOcrNoise(left, right);
};

const compareInFrontend = (
  expedientId: string,
  rawExtractions: Partial<Record<DocumentType, SlotExtraction>>
): CompareExpedientResponse => {
  const invoice = rawExtractions.invoice;
  const certificate = rawExtractions.certificate_of_origin;
  const photoPlate = rawExtractions.photo_plate;
  const photoSerial = rawExtractions.photo_serial;

  const invoicePlate = normalizePlate(invoice?.plate);
  const certificatePlate = normalizePlate(certificate?.plate);
  const imagePlate = normalizePlate(photoPlate?.plate);

  const invoiceSerial = normalizeSerial(invoice?.serial);
  const certificateSerial = normalizeSerial(certificate?.serial);
  const imageSerial = normalizeSerial(photoSerial?.serial);

  // Regla de negocio:
  // 1) Factura vs certificado de origen
  // 2) Fotoplaca vs placa del certificado de origen
  // 3) Fotoserial vs serial del certificado de origen
  const invoicePlateMatch = compareTwo(invoicePlate, certificatePlate, 'plate');
  const invoiceSerialMatch = compareTwo(invoiceSerial, certificateSerial, 'serial');
  const plateMatch = compareTwo(certificatePlate, imagePlate, 'plate');
  const serialMatch = compareTwo(certificateSerial, imageSerial, 'serial');

  const invoiceValid = Boolean(invoice?.document_valid);
  const certificateValid = Boolean(certificate?.document_valid);
  const photoPlateValid = Boolean(photoPlate?.document_valid);
  const photoSerialValid = Boolean(photoSerial?.document_valid);
  const sameExpedient =
    invoiceValid &&
    certificateValid &&
    photoPlateValid &&
    photoSerialValid &&
    invoicePlateMatch === true &&
    invoiceSerialMatch === true &&
    plateMatch === true &&
    serialMatch === true;

  const messages: string[] = [];
  messages.push(invoiceValid ? 'La factura corresponde al tipo esperado.' : `Factura: ${invoice?.reason ?? 'No válida.'}`);
  messages.push(
    certificateValid
      ? 'El certificado de origen corresponde al tipo esperado.'
      : `Certificado: ${certificate?.reason ?? 'No válido.'}`
  );
  messages.push(photoPlateValid ? 'La fotoplaca es válida.' : `Fotoplaca: ${photoPlate?.reason ?? 'No válida.'}`);
  messages.push(photoSerialValid ? 'El fotoserial es válido.' : `Fotoserial: ${photoSerial?.reason ?? 'No válido.'}`);
  messages.push(
    invoicePlateMatch === true
      ? 'La placa de la factura coincide con el certificado de origen.'
      : invoicePlateMatch === false
        ? 'La placa de la factura no coincide con el certificado de origen.'
        : 'No hay datos suficientes para validar placa entre factura y certificado.'
  );
  messages.push(
    invoiceSerialMatch === true
      ? 'El serial de la factura coincide con el certificado de origen.'
      : invoiceSerialMatch === false
        ? 'El serial de la factura no coincide con el certificado de origen.'
        : 'No hay datos suficientes para validar serial entre factura y certificado.'
  );
  messages.push(
    plateMatch === true
      ? 'La placa de fotoplaca coincide con el certificado de origen.'
      : plateMatch === false
        ? 'La placa de fotoplaca no coincide con el certificado de origen.'
        : 'No hay datos suficientes para validar placa (certificado/fotoplaca).'
  );
  messages.push(
    serialMatch === true
      ? 'El serial de fotoserial coincide con el certificado de origen.'
      : serialMatch === false
        ? 'El serial de fotoserial no coincide con el certificado de origen.'
        : 'No hay datos suficientes para validar serial (certificado/fotoserial).'
  );

  return {
    success: true,
    expedient_id: expedientId,
    raw_extractions: rawExtractions,
    document_validation: {
      invoice_valid: invoiceValid,
      certificate_of_origin_valid: certificateValid,
      photo_plate_valid: photoPlateValid,
      photo_serial_valid: photoSerialValid
    },
    extracted_data: {
      invoice_plate: invoicePlate,
      certificate_plate: certificatePlate,
      photo_plate: imagePlate,
      invoice_serial: invoiceSerial,
      certificate_serial: certificateSerial,
      photo_serial: imageSerial
    },
    cross_validation: {
      plate_match: plateMatch,
      serial_match: serialMatch,
      same_expedient: sameExpedient
    },
    overall_status: sameExpedient ? 'validated' : 'manual_review',
    messages
  };
};

export const validateDocuments = async (
  expedientId: string,
  filesBySlot: Record<DocumentSlot, File>
): Promise<ValidateDocumentsResponse> => {
  const [invoiceRaw, certificateRaw] = await Promise.all([
    validateSingleSlot('invoice', filesBySlot.invoice, expedientId),
    validateSingleSlot('certificate_of_origin', filesBySlot.certificate_of_origin, expedientId)
  ]);
  const invoice = applyFilenamePlateHint(invoiceRaw, filesBySlot.invoice.name);
  const certificate = applyFilenamePlateHint(certificateRaw, filesBySlot.certificate_of_origin.name);
  const frontendRequired = {
    invoice,
    certificate_of_origin: certificate
  };

  return {
    success: true,
    expedient_id: expedientId,
    phase: 'documents',
    frontend_required: frontendRequired,
    raw_extractions: {
      invoice,
      certificate_of_origin: certificate
    }
  };
};

export const validateImages = async (
  expedientId: string,
  filesBySlot: Record<ImageSlot, File>,
  options?: { referenceSerial?: string }
): Promise<ValidateImagesResponse> => {
  const [photoPlate, photoSerial] = await Promise.all([
    validateSingleSlot('photo_plate', filesBySlot.photo_plate, expedientId),
    validateSingleSlot('photo_serial', filesBySlot.photo_serial, expedientId, {
      referenceSerial: options?.referenceSerial
    })
  ]);
  const frontendRequired = {
    photo_plate: photoPlate,
    photo_serial: photoSerial
  };

  return {
    success: true,
    expedient_id: expedientId,
    phase: 'images',
    frontend_required: frontendRequired,
    raw_extractions: {
      photo_plate: photoPlate,
      photo_serial: photoSerial
    }
  };
};

export const compareExpedient = async (
  expedientId: string,
  rawExtractions: Partial<Record<DocumentType, SlotExtraction>>
): Promise<CompareExpedientResponse> => {
  return compareInFrontend(expedientId, rawExtractions);
};

export const toValidationResult = (response: CompareExpedientResponse): ValidationResult => {
  return {
    invoice_document_valid: Boolean(response.document_validation?.invoice_valid),
    certificate_document_valid: Boolean(response.document_validation?.certificate_of_origin_valid),
    photo_plate_valid: Boolean(response.document_validation?.photo_plate_valid),
    photo_serial_valid: Boolean(response.document_validation?.photo_serial_valid),
    plate_match: Boolean(response.cross_validation?.plate_match),
    serial_match: Boolean(response.cross_validation?.serial_match),
    overall_status: response.overall_status === 'validated' ? 'validated' : 'manual_review',
    messages:
      response.messages && response.messages.length > 0
        ? response.messages
        : ['Validación completada. Revise el resultado del expediente.']
  };
};
