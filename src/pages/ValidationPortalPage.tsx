import { ChangeEvent, useMemo, useRef, useState } from 'react';

type FlowStep = 'login' | 'upload' | 'json';
type VehicleDocumentType = 'certificate_of_origin' | 'circulation_card' | 'unknown';

interface VehicleData {
  documentType: VehicleDocumentType;
  ownerId: string;
  ownerName: string;
  plate: string;
  vin: string;
  engineSerial: string;
  brand: string;
  model: string;
  year: string;
  color: string;
  vehicleClass: string;
  useType: string;
}

interface ExtractionMeta {
  documentValid: boolean;
  confidence: number | null;
  missingFields: string[];
  messages: string[];
}

const emptyVehicleData: VehicleData = {
  documentType: 'unknown',
  ownerId: '',
  ownerName: '',
  plate: '',
  vin: '',
  engineSerial: '',
  brand: '',
  model: '',
  year: '',
  color: '',
  vehicleClass: '',
  useType: ''
};

const emptyExtractionMeta: ExtractionMeta = {
  documentValid: false,
  confidence: null,
  missingFields: [],
  messages: []
};

const documentTypeLabel: Record<VehicleDocumentType, string> = {
  certificate_of_origin: 'Certificado de origen',
  circulation_card: 'Carnet de circulacion',
  unknown: 'Documento no reconocido'
};

const normalizeStoredId = (value: string) => value.replace(/\s+/g, '').toUpperCase();
const normalizeId = (prefix: string, value: string) => `${prefix}${value.replace(/\D/g, '')}`.toUpperCase();
const isValidIdentity = (value: string) => /^\d{6,10}$/.test(value.replace(/\D/g, ''));

const LAMBDA_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_NOMBRE_FUNCION_LAMBDA_URL) as string | undefined;

interface LambdaVehicleExtraction {
  document_valid: boolean;
  document_type: VehicleDocumentType;
  confidence?: number;
  vehicle: Partial<Record<keyof VehicleData, string | null>>;
  missing_fields?: string[];
  messages?: string[];
}

interface ExtractedVehiclePayload {
  vehicle: VehicleData;
  meta: ExtractionMeta;
}

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });

const asText = (value: string | null | undefined) => String(value ?? '');

const extractVehicleWithLambda = async (file: File): Promise<ExtractedVehiclePayload> => {
  if (!LAMBDA_URL) {
    throw new Error('VITE_API_URL no esta configurado.');
  }

  const contentBase64 = await readFileAsBase64(file);
  const response = await fetch(LAMBDA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'extract_vehicle_document',
      document: {
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        content_base64: contentBase64
      }
    })
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || payload.error || 'Documento invalido o ilegible. Por favor carga un certificado de origen o carnet de circulacion valido y legible.');
  }

  const extraction = payload.extraction as LambdaVehicleExtraction;
  if (!extraction.document_valid || extraction.document_type === 'unknown') {
    throw new Error('Documento invalido o ilegible. Por favor carga un certificado de origen o carnet de circulacion valido y legible.');
  }

  const vehicle = extraction.vehicle ?? {};
  const hasVin = Boolean(vehicle.vin);
  const hasVehicleDescription = Boolean(vehicle.brand || vehicle.model || vehicle.year || vehicle.plate);
  if (!hasVin || !hasVehicleDescription || (extraction.document_type === 'circulation_card' && !vehicle.plate)) {
    throw new Error('Documento invalido o ilegible. Por favor carga un certificado de origen o carnet de circulacion valido y legible.');
  }

  return {
    vehicle: {
      documentType: extraction.document_type,
      ownerId: asText(vehicle.ownerId),
      ownerName: asText(vehicle.ownerName),
      plate: asText(vehicle.plate),
      vin: asText(vehicle.vin),
      engineSerial: asText(vehicle.engineSerial),
      brand: asText(vehicle.brand),
      model: asText(vehicle.model),
      year: asText(vehicle.year),
      color: asText(vehicle.color),
      vehicleClass: asText(vehicle.vehicleClass),
      useType: asText(vehicle.useType)
    },
    meta: {
      documentValid: extraction.document_valid,
      confidence: typeof extraction.confidence === 'number' ? extraction.confidence : null,
      missingFields: extraction.missing_fields ?? [],
      messages: extraction.messages ?? []
    }
  };
};

const validateVehicleData = (data: VehicleData) => {
  const errors: string[] = [];
  if (!data.ownerId.trim()) errors.push('La cedula o RIF del titular es obligatoria.');
  if (!data.ownerName.trim()) errors.push('El nombre del titular es obligatorio.');
  if (!data.brand.trim()) errors.push('La marca del vehiculo es obligatoria.');
  if (!data.model.trim()) errors.push('El modelo del vehiculo es obligatorio.');
  if (!/^\d{4}$/.test(data.year.trim())) errors.push('El ano debe tener cuatro digitos.');
  if (!data.vin.trim()) errors.push('El VIN o serial de carroceria es obligatorio.');
  if (data.documentType === 'circulation_card' && !data.plate.trim()) {
    errors.push('La placa es obligatoria cuando se carga carnet de circulacion.');
  }
  return errors;
};

const ValidationPortalPage = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const storedIdentity = sessionStorage.getItem('autoPortalIdentity') ?? '';
  const [step, setStep] = useState<FlowStep>(storedIdentity ? 'upload' : 'login');
  const [identityPrefix, setIdentityPrefix] = useState('V');
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [identityTouched, setIdentityTouched] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [vehicleData, setVehicleData] = useState<VehicleData>(emptyVehicleData);
  const [extractionMeta, setExtractionMeta] = useState<ExtractionMeta>(emptyExtractionMeta);
  const [isExtracting, setIsExtracting] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const normalizedIdentity = storedIdentity || normalizeId(identityPrefix, identity);
  const identityIsValid = isValidIdentity(identity);
  const canLogin = identityIsValid && password.trim().length > 0;
  const hasExtractedDocument = Boolean(uploadedFile && extractionMeta.documentValid);
  const validationErrors = useMemo(() => validateVehicleData(vehicleData), [vehicleData]);
  const canShowJson = hasExtractedDocument && validationErrors.length === 0;

  const finalJson = useMemo(
    () => ({
      document: {
        type: vehicleData.documentType,
        label: documentTypeLabel[vehicleData.documentType],
        fileName: uploadedFile?.name ?? null,
        valid: extractionMeta.documentValid,
        confidence: extractionMeta.confidence,
        missingFields: extractionMeta.missingFields,
        messages: extractionMeta.messages
      },
      vehicle: vehicleData
    }),
    [extractionMeta, uploadedFile?.name, vehicleData]
  );

  const updateField = (field: keyof VehicleData, value: string) => {
    setVehicleData((prev) => ({ ...prev, [field]: value }));
  };

  const handleLogin = () => {
    setIdentityTouched(true);
    if (!canLogin) return;
    sessionStorage.setItem('autoPortalIdentity', normalizeId(identityPrefix, identity));
    setStep('upload');
  };

  const handleResetDocument = () => {
    setUploadedFile(null);
    setVehicleData(emptyVehicleData);
    setExtractionMeta(emptyExtractionMeta);
    setUploadError('');
    setStep('upload');
  };

  const handleSelectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg'];
    const allowedByName = /\.(pdf|png|jpe?g)$/i.test(file.name);
    if (!allowedTypes.includes(file.type) && !allowedByName) {
      setUploadError('Carga un PDF, PNG o JPG del certificado de origen o carnet de circulacion.');
      return;
    }

    setUploadError('');
    setUploadedFile(file);
    setVehicleData(emptyVehicleData);
    setExtractionMeta(emptyExtractionMeta);
    setIsExtracting(true);
    setStep('upload');

    try {
      const extracted = await extractVehicleWithLambda(file);
      setVehicleData({
        ...extracted.vehicle,
        ownerId: extracted.vehicle.ownerId || normalizeStoredId(normalizedIdentity)
      });
      setExtractionMeta(extracted.meta);
      setStep('upload');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo procesar el documento.';
      setUploadError(message);
      setUploadedFile(null);
      setVehicleData(emptyVehicleData);
      setExtractionMeta(emptyExtractionMeta);
      setStep('upload');
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <section className="container-app py-8 sm:py-10">
      <div className="mt-6 grid gap-5 lg:grid-cols-[280px,1fr]">
        <aside className="rounded-2xl border border-white/10 bg-brand-primary/70 p-4 text-white shadow-card">
          <div className="space-y-3">
            {[
              ['1', 'Documento', step === 'json'],
              ['2', 'JSON', false]
            ].map(([number, label, done]) => (
              <div key={String(label)} className="flex items-center gap-3 rounded-xl bg-white/8 px-3 py-3">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                    done ? 'bg-brand-lilac text-brand-primary' : 'bg-white/10 text-white'
                  }`}
                >
                  {number}
                </span>
                <span className="text-sm font-semibold">{label}</span>
              </div>
            ))}
          </div>
        </aside>

        <div className="space-y-5">
          {step === 'login' ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
              <label className="block space-y-1 text-sm font-semibold text-slate-700">
                <span>Cedula o RIF</span>
                <div className="flex overflow-hidden rounded-xl border border-slate-300 bg-white transition focus-within:border-brand-secondary">
                  <select
                    value={identityPrefix}
                    onChange={(event) => setIdentityPrefix(event.target.value)}
                    className="border-r border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-800 outline-none"
                    aria-label="Tipo de documento"
                  >
                    <option value="V">V</option>
                    <option value="E">E</option>
                    <option value="J">J</option>
                    <option value="G">G</option>
                  </select>
                  <input
                    type="text"
                    value={identity}
                    onBlur={() => setIdentityTouched(true)}
                    onChange={(event) => setIdentity(event.target.value.replace(/\D/g, ''))}
                    className="min-w-0 flex-1 px-3 py-2.5 text-sm text-slate-900 outline-none"
                    placeholder="12345678"
                    inputMode="numeric"
                  />
                </div>
              </label>
              <label className="mt-4 block space-y-1 text-sm font-semibold text-slate-700">
                <span>Contraseña</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-secondary"
                  placeholder="Contraseña demo"
                />
              </label>
              {identityTouched && !identityIsValid ? (
                <p className="mt-2 text-sm font-medium text-rose-700">Ingresa un numero de cedula o RIF valido.</p>
              ) : null}
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={handleLogin}
                  className={`btn-primary ${!canLogin ? 'cursor-not-allowed opacity-50' : ''}`}
                  disabled={!canLogin}
                >
                  Continuar
                </button>
              </div>
            </div>
          ) : null}

          {step === 'upload' && !hasExtractedDocument ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <h2 className="font-display text-lg font-bold text-brand-primary">
                  Carga el certificado de origen o carnet de circulacion
                </h2>
                <span className="rounded-full bg-brand-light px-3 py-1 text-xs font-semibold text-brand-secondary">
                  Titular: {normalizedIdentity}
                </span>
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-5 flex min-h-44 w-full flex-col items-center justify-center rounded-xl border border-dashed border-brand-lilac bg-brand-light/50 px-4 py-8 text-center transition hover:border-brand-secondary hover:bg-brand-light"
              >
                <span className="text-sm font-bold text-brand-primary">
                  {isExtracting ? 'Extrayendo informacion...' : 'Seleccionar documento'}
                </span>
                <span className="mt-2 text-xs font-medium text-slate-500">
                  {uploadedFile ? uploadedFile.name : 'PDF, PNG o JPG'}
                </span>
              </button>
              <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleSelectFile} className="hidden" />

              {isExtracting ? (
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-brand-light">
                  <div className="h-full w-1/2 animate-pulse rounded-full bg-brand-secondary" />
                </div>
              ) : null}
              {uploadError ? <p className="mt-3 text-sm font-medium text-rose-700">{uploadError}</p> : null}
            </div>
          ) : null}

          {step === 'upload' && hasExtractedDocument ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
              <h2 className="font-display text-lg font-bold text-brand-primary">Revisa la informacion detectada</h2>

              <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-brand-light bg-brand-light/50 px-4 py-3 text-sm text-brand-primary">
                <div className="min-w-0">
                  Documento detectado: <strong>{documentTypeLabel[vehicleData.documentType]}</strong>
                  {uploadedFile ? <span className="text-slate-500"> · {uploadedFile.name}</span> : null}
                </div>
                <button
                  type="button"
                  onClick={handleResetDocument}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-300 text-sm font-bold text-slate-500 transition hover:border-rose-400 hover:text-rose-600"
                  aria-label="Quitar documento adjunto"
                  title="Quitar documento"
                >
                  x
                </button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Titular</span>
                  <input value={vehicleData.ownerName} onChange={(event) => updateField('ownerName', event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-secondary" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Cedula/RIF</span>
                  <input value={vehicleData.ownerId} onChange={(event) => updateField('ownerId', event.target.value.toUpperCase())} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase outline-none focus:border-brand-secondary" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Placa</span>
                  <input value={vehicleData.plate} onChange={(event) => updateField('plate', event.target.value.toUpperCase())} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase outline-none focus:border-brand-secondary" placeholder="Sin placa si aplica" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>VIN / Serial carroceria</span>
                  <input value={vehicleData.vin} onChange={(event) => updateField('vin', event.target.value.toUpperCase())} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase outline-none focus:border-brand-secondary" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Serial motor</span>
                  <input value={vehicleData.engineSerial} onChange={(event) => updateField('engineSerial', event.target.value.toUpperCase())} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase outline-none focus:border-brand-secondary" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Marca</span>
                  <input value={vehicleData.brand} onChange={(event) => updateField('brand', event.target.value.toUpperCase())} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase outline-none focus:border-brand-secondary" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Modelo</span>
                  <input value={vehicleData.model} onChange={(event) => updateField('model', event.target.value.toUpperCase())} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase outline-none focus:border-brand-secondary" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Ano</span>
                  <input value={vehicleData.year} onChange={(event) => updateField('year', event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-secondary" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Color</span>
                  <input value={vehicleData.color} onChange={(event) => updateField('color', event.target.value.toUpperCase())} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase outline-none focus:border-brand-secondary" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Uso</span>
                  <select value={vehicleData.useType} onChange={(event) => updateField('useType', event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-secondary">
                    <option value="">Seleccionar</option>
                    <option value="PARTICULAR">Particular</option>
                    <option value="COMERCIAL">Comercial</option>
                    <option value="CARGA">Carga</option>
                  </select>
                </label>
              </div>

              {validationErrors.length > 0 ? (
                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                  {validationErrors[0]}
                </div>
              ) : null}

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep('json')}
                  disabled={!canShowJson}
                  className={`btn-primary ${!canShowJson ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  Ver JSON
                </button>
              </div>
            </div>
          ) : null}

          {step === 'json' ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
              <h2 className="font-display text-lg font-bold text-brand-primary">JSON generado</h2>

              <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-brand-light bg-brand-light/50 px-4 py-3 text-sm text-brand-primary">
                <div className="min-w-0">
                  Documento detectado: <strong>{documentTypeLabel[vehicleData.documentType]}</strong>
                  {uploadedFile ? <span className="text-slate-500"> · {uploadedFile.name}</span> : null}
                </div>
                <button
                  type="button"
                  onClick={handleResetDocument}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-300 text-sm font-bold text-slate-500 transition hover:border-rose-400 hover:text-rose-600"
                  aria-label="Quitar documento adjunto"
                  title="Quitar documento"
                >
                  x
                </button>
              </div>

              <pre className="mt-5 max-h-[520px] overflow-auto rounded-xl bg-brand-primary p-4 text-xs leading-6 text-brand-light">
                {JSON.stringify(finalJson, null, 2)}
              </pre>
              <div className="mt-5 flex justify-end gap-3">
                <button type="button" onClick={() => setStep('upload')} className="btn-secondary">
                  Volver a revisar
                </button>
                <button type="button" onClick={handleResetDocument} className="btn-primary">
                  Procesar otro documento
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};

export default ValidationPortalPage;
