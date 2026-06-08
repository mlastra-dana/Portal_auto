type VehicleDocumentType = 'certificate_of_origin' | 'circulation_card' | 'unknown';
type SendStatus = 'sent' | 'simulated';

interface FunctionUrlEvent {
  requestContext?: { http?: { method?: string } };
  body?: string | null;
  isBase64Encoded?: boolean;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

interface IncomingDocument {
  fileName?: string | null;
  filename?: string | null;
  contentType?: string | null;
  content_type?: string | null;
  content_base64?: string | null;
  s3_key?: string | null;
  s3_bucket?: string | null;
}

interface VehicleData {
  documentType: VehicleDocumentType;
  ownerId: string | null;
  ownerName: string | null;
  plate: string | null;
  vin: string | null;
  engineSerial: string | null;
  brand: string | null;
  model: string | null;
  year: string | null;
  color: string | null;
  vehicleClass: string | null;
  useType: string | null;
}

interface VehicleExtractionResult {
  document_valid: boolean;
  document_type: VehicleDocumentType;
  vehicle: VehicleData;
  confidence: number;
  missing_fields: string[];
  messages: string[];
  raw_provider_response?: unknown;
}

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'OPTIONS,POST'
};

const IDP_ENDPOINT_URL = process.env.IDP_ENDPOINT_URL ?? '';
const DANACONNECT_ENDPOINT_URL = process.env.DANACONNECT_ENDPOINT_URL ?? '';
const DANACONNECT_API_KEY = process.env.DANACONNECT_API_KEY ?? '';

const response = (statusCode: number, body: Record<string, unknown>): LambdaResponse => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify(body)
});

const parseBody = (event: FunctionUrlEvent): Record<string, unknown> => {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body;
  return JSON.parse(raw) as Record<string, unknown>;
};

const normalizeId = (value: unknown): string => String(value ?? '').replace(/\s+/g, '').toUpperCase();
const normalizeText = (value: unknown): string | null => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
};
const normalizeUpper = (value: unknown): string | null => {
  const text = normalizeText(value);
  return text ? text.toUpperCase() : null;
};
const normalizePlate = (value: unknown): string | null => {
  const text = String(value ?? '').replace(/\s+/g, '').toUpperCase();
  return text || null;
};
const normalizeVin = (value: unknown): string | null => {
  const text = String(value ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return text || null;
};

const isValidIdentity = (value: unknown): boolean => /^(V|E|J|G)?-?\d{6,10}$/.test(normalizeId(value));

const filenameOf = (document: IncomingDocument): string => document.fileName ?? document.filename ?? 'documento';

const detectDocumentType = (document: IncomingDocument, explicit?: unknown): VehicleDocumentType => {
  const explicitType = String(explicit ?? '').trim();
  if (explicitType === 'certificate_of_origin' || explicitType === 'circulation_card') return explicitType;

  const name = filenameOf(document).toLowerCase();
  if (name.includes('certificado') || name.includes('origen') || name.includes('certificate')) {
    return 'certificate_of_origin';
  }
  if (name.includes('carnet') || name.includes('circulacion') || name.includes('circulation')) {
    return 'circulation_card';
  }
  return 'unknown';
};

const validateDocument = (document: IncomingDocument): string[] => {
  const errors: string[] = [];
  const filename = filenameOf(document);
  if (!filename || filename === 'documento') errors.push('fileName es requerido.');

  const hasSource = Boolean(document.content_base64 || document.s3_key || filename);
  if (!hasSource) errors.push('Debe enviarse contenido base64, referencia S3 o nombre de archivo.');

  const allowed = /\.(pdf|png|jpe?g)$/i.test(filename);
  if (!allowed) errors.push('El documento debe ser PDF, PNG o JPG.');
  return errors;
};

const validateVehicle = (vehicle: VehicleData): string[] => {
  const errors: string[] = [];
  if (!vehicle.ownerId) errors.push('ownerId es requerido.');
  if (!vehicle.ownerName) errors.push('ownerName es requerido.');
  if (!vehicle.brand) errors.push('brand es requerido.');
  if (!vehicle.model) errors.push('model es requerido.');
  if (!vehicle.year || !/^\d{4}$/.test(vehicle.year)) errors.push('year debe tener cuatro digitos.');
  if (!vehicle.vin) errors.push('vin es requerido.');
  if (vehicle.documentType === 'circulation_card' && !vehicle.plate) {
    errors.push('plate es requerido para carnet de circulacion.');
  }
  return errors;
};

const mockExtractVehicle = (identity: string, document: IncomingDocument, explicitType?: unknown): VehicleExtractionResult => {
  const documentType = detectDocumentType(document, explicitType);
  const name = filenameOf(document).toLowerCase();
  const isToyota = name.includes('toyota') || name.includes('corolla');

  const vehicle: VehicleData = {
    documentType,
    ownerId: normalizeId(identity),
    ownerName: name.includes('empresa') ? 'Example Company Servicios C.A.' : 'Maria Alejandra Lastra',
    plate: documentType === 'certificate_of_origin' ? null : isToyota ? 'AA123BB' : 'AF482KM',
    vin: isToyota ? '9BWZZZ377VT004251' : '8X1AB2CD3E4567890',
    engineSerial: isToyota ? 'ENG-77VT004251' : 'MTR-4567890',
    brand: isToyota ? 'Toyota' : 'Chevrolet',
    model: isToyota ? 'Corolla XEI' : 'Onix Turbo',
    year: isToyota ? '2021' : '2024',
    color: isToyota ? 'Gris plata' : 'Blanco',
    vehicleClass: 'Automovil',
    useType: 'Particular'
  };

  const missingFields = validateVehicle(vehicle).map((error) => error.split(' ')[0] ?? error);
  return {
    document_valid: documentType !== 'unknown',
    document_type: documentType,
    vehicle,
    confidence: documentType === 'unknown' ? 0.35 : 0.86,
    missing_fields: missingFields,
    messages: [
      documentType === 'unknown'
        ? 'No se pudo determinar si el documento es certificado de origen o carnet de circulacion.'
        : `Documento detectado: ${documentType === 'certificate_of_origin' ? 'certificado de origen' : 'carnet de circulacion'}.`,
      'Extraccion simulada por nombre de archivo; configure IDP_ENDPOINT_URL para usar OCR/IDP real.'
    ]
  };
};

const normalizeVehicleFromProvider = (
  identity: string,
  providerResponse: Record<string, unknown>,
  document: IncomingDocument,
  explicitType?: unknown
): VehicleExtractionResult => {
  const data = (providerResponse.vehicle ?? providerResponse.data ?? providerResponse) as Record<string, unknown>;
  const documentType = detectDocumentType(document, providerResponse.document_type ?? data.documentType ?? explicitType);

  const vehicle: VehicleData = {
    documentType,
    ownerId: normalizeId(data.ownerId ?? data.owner_id ?? identity),
    ownerName: normalizeText(data.ownerName ?? data.owner_name ?? data.titular),
    plate: normalizePlate(data.plate ?? data.placa),
    vin: normalizeVin(data.vin ?? data.serial ?? data.chassis ?? data.serial_carroceria),
    engineSerial: normalizeUpper(data.engineSerial ?? data.engine_serial ?? data.serial_motor),
    brand: normalizeText(data.brand ?? data.marca),
    model: normalizeText(data.model ?? data.modelo),
    year: normalizeText(data.year ?? data.ano ?? data.anio),
    color: normalizeText(data.color),
    vehicleClass: normalizeText(data.vehicleClass ?? data.vehicle_class ?? data.clase) ?? 'Automovil',
    useType: normalizeText(data.useType ?? data.use_type ?? data.uso) ?? 'Particular'
  };

  const missingFields = validateVehicle(vehicle).map((error) => error.split(' ')[0] ?? error);
  return {
    document_valid: Boolean(providerResponse.document_valid ?? documentType !== 'unknown'),
    document_type: documentType,
    vehicle,
    confidence: Number(providerResponse.confidence ?? 0.9),
    missing_fields: missingFields,
    messages: Array.isArray(providerResponse.messages)
      ? (providerResponse.messages as string[])
      : ['Extraccion recibida desde OCR/IDP.'],
    raw_provider_response: providerResponse
  };
};

const callJsonEndpoint = async (url: string, payload: Record<string, unknown>, apiKey?: string) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const result = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  const text = await result.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!result.ok) {
    throw new Error(`Endpoint respondio ${result.status}: ${text}`);
  }
  return parsed as Record<string, unknown>;
};

const extractVehicleDocument = async (body: Record<string, unknown>) => {
  const identity = normalizeId(body.identity ?? body.ownerId ?? body.owner_id);
  const document = (body.document ?? {}) as IncomingDocument;
  const documentType = body.documentType ?? body.document_type;

  if (!isValidIdentity(identity)) {
    return response(400, { ok: false, message: 'identity debe ser una cedula o RIF valido.' });
  }

  const documentErrors = validateDocument(document);
  if (documentErrors.length > 0) {
    return response(400, { ok: false, message: 'Documento invalido.', errors: documentErrors });
  }

  let extraction: VehicleExtractionResult;
  if (IDP_ENDPOINT_URL) {
    const providerResponse = await callJsonEndpoint(IDP_ENDPOINT_URL, {
      identity,
      document_type: documentType,
      document
    });
    extraction = normalizeVehicleFromProvider(identity, providerResponse, document, documentType);
  } else {
    extraction = mockExtractVehicle(identity, document, documentType);
  }

  return response(200, {
    ok: true,
    action: 'extract_vehicle_document',
    extraction,
    dana_payload_preview: buildDanaPayload(identity, document, extraction.vehicle)
  });
};

const buildDanaPayload = (identity: string, document: IncomingDocument, vehicle: VehicleData) => ({
  source: 'auto_portal_example_company',
  identity: normalizeId(identity),
  submitted_at: new Date().toISOString(),
  uploaded_document: {
    file_name: filenameOf(document),
    content_type: document.contentType ?? document.content_type ?? null,
    document_type: vehicle.documentType
  },
  vehicle
});

const sendVehicleToDana = async (body: Record<string, unknown>) => {
  const identity = normalizeId(body.identity ?? body.ownerId ?? body.owner_id);
  const document = (body.document ?? body.uploaded_document ?? {}) as IncomingDocument;
  const vehicleInput = (body.vehicle ?? {}) as Partial<VehicleData>;

  const vehicle: VehicleData = {
    documentType: vehicleInput.documentType ?? vehicleInput.documentType ?? detectDocumentType(document),
    ownerId: normalizeId(vehicleInput.ownerId ?? identity),
    ownerName: normalizeText(vehicleInput.ownerName),
    plate: normalizePlate(vehicleInput.plate),
    vin: normalizeVin(vehicleInput.vin),
    engineSerial: normalizeUpper(vehicleInput.engineSerial),
    brand: normalizeText(vehicleInput.brand),
    model: normalizeText(vehicleInput.model),
    year: normalizeText(vehicleInput.year),
    color: normalizeText(vehicleInput.color),
    vehicleClass: normalizeText(vehicleInput.vehicleClass) ?? 'Automovil',
    useType: normalizeText(vehicleInput.useType) ?? 'Particular'
  };

  if (!isValidIdentity(identity)) {
    return response(400, { ok: false, message: 'identity debe ser una cedula o RIF valido.' });
  }

  const vehicleErrors = validateVehicle(vehicle);
  if (vehicleErrors.length > 0) {
    return response(400, { ok: false, message: 'Datos del vehiculo incompletos.', errors: vehicleErrors });
  }

  const danaPayload = buildDanaPayload(identity, document, vehicle);
  let status: SendStatus = 'simulated';
  let danaResponse: Record<string, unknown> | null = null;

  if (DANACONNECT_ENDPOINT_URL) {
    danaResponse = await callJsonEndpoint(DANACONNECT_ENDPOINT_URL, danaPayload, DANACONNECT_API_KEY);
    status = 'sent';
  }

  return response(200, {
    ok: true,
    action: 'send_vehicle_to_danaconnect',
    status,
    message:
      status === 'sent'
        ? 'Informacion enviada a DANAConnect.'
        : 'Envio simulado. Configure DANACONNECT_ENDPOINT_URL para usar el endpoint real.',
    dana_payload: danaPayload,
    dana_response: danaResponse
  });
};

export const handler = async (rawEvent: unknown): Promise<LambdaResponse> => {
  const event = rawEvent as FunctionUrlEvent;
  const method = event.requestContext?.http?.method ?? 'POST';

  if (method === 'OPTIONS') return response(200, { ok: true });
  if (method !== 'POST') return response(405, { ok: false, message: 'Method not allowed.' });

  try {
    const body = parseBody(event);
    const action = String(body.action ?? 'extract_vehicle_document');

    if (action === 'extract_vehicle_document') return await extractVehicleDocument(body);
    if (action === 'send_vehicle_to_danaconnect') return await sendVehicleToDana(body);

    return response(400, {
      ok: false,
      message: 'Accion no soportada.',
      supported_actions: ['extract_vehicle_document', 'send_vehicle_to_danaconnect']
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error no controlado';
    return response(500, {
      ok: false,
      message: 'Fallo la funcion Auto Portal.',
      error: message
    });
  }
};
