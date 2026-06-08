import { ChangeEvent, useMemo, useRef, useState } from 'react';

type FlowStep = 'login' | 'upload' | 'review';
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
  vehicleClass: 'Automovil',
  useType: 'Particular'
};

const documentTypeLabel: Record<VehicleDocumentType, string> = {
  certificate_of_origin: 'Certificado de origen',
  circulation_card: 'Carnet de circulacion',
  unknown: 'Documento vehicular'
};

const normalizeId = (value: string) => value.replace(/\s+/g, '').toUpperCase();
const isValidIdentity = (value: string) => /^(V|E|J|G)?-?\d{6,10}$/.test(normalizeId(value));

const LAMBDA_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_NOMBRE_FUNCION_LAMBDA_URL) as string | undefined;

interface LambdaVehicleExtraction {
  document_valid: boolean;
  document_type: VehicleDocumentType;
  vehicle: Partial<Record<keyof VehicleData, string | null>>;
  missing_fields?: string[];
  messages?: string[];
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

const extractVehicleWithLambda = async (file: File): Promise<VehicleData> => {
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
    throw new Error(payload.message || payload.error || 'No se pudo extraer informacion del documento.');
  }

  const extraction = payload.extraction as LambdaVehicleExtraction;
  const vehicle = extraction.vehicle ?? {};
  return {
    documentType: extraction.document_type ?? 'unknown',
    ownerId: String(vehicle.ownerId ?? ''),
    ownerName: String(vehicle.ownerName ?? ''),
    plate: String(vehicle.plate ?? ''),
    vin: String(vehicle.vin ?? ''),
    engineSerial: String(vehicle.engineSerial ?? ''),
    brand: String(vehicle.brand ?? ''),
    model: String(vehicle.model ?? ''),
    year: String(vehicle.year ?? ''),
    color: String(vehicle.color ?? ''),
    vehicleClass: String(vehicle.vehicleClass ?? 'Automovil'),
    useType: String(vehicle.useType ?? 'Particular')
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
  const [identity, setIdentity] = useState(storedIdentity);
  const [identityTouched, setIdentityTouched] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [vehicleData, setVehicleData] = useState<VehicleData>(emptyVehicleData);
  const [isExtracting, setIsExtracting] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const normalizedIdentity = normalizeId(identity);
  const identityIsValid = isValidIdentity(identity);
  const validationErrors = useMemo(() => validateVehicleData(vehicleData), [vehicleData]);
  const canFinish = validationErrors.length === 0 && Boolean(uploadedFile);

  const updateField = (field: keyof VehicleData, value: string) => {
    setVehicleData((prev) => ({ ...prev, [field]: value }));
  };

  const handleLogin = () => {
    setIdentityTouched(true);
    if (!identityIsValid) return;
    sessionStorage.setItem('autoPortalIdentity', normalizedIdentity);
    setVehicleData((prev) => ({ ...prev, ownerId: normalizedIdentity }));
    setStep('upload');
  };

  const handleSelectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg'];
    const allowedByName = /\.(pdf|png|jpe?g)$/i.test(file.name);
    if (!allowedTypes.includes(file.type) && !allowedByName) {
      setUploadError('Carga un PDF, PNG o JPG del documento del vehiculo.');
      return;
    }

    setUploadError('');
    setUploadedFile(file);
    setIsExtracting(true);
    setStep('upload');

    try {
      const extractedData = await extractVehicleWithLambda(file);
      setVehicleData({
        ...extractedData,
        ownerId: extractedData.ownerId || normalizedIdentity
      });
      setStep('review');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo procesar el documento.';
      setUploadError(message);
      setUploadedFile(null);
      setStep('upload');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleResetDocument = () => {
    setUploadedFile(null);
    setVehicleData({ ...emptyVehicleData, ownerId: normalizedIdentity });
    setUploadError('');
    setStep('upload');
  };



  return (
    <section className="container-app py-8 sm:py-10">
      <div className="mt-6 grid gap-5 lg:grid-cols-[280px,1fr]">
        <aside className="rounded-2xl border border-white/10 bg-brand-primary/70 p-4 text-white shadow-card">
          <div className="space-y-3">
            {[
              ['1', 'Identificacion', step !== 'login'],
              ['2', 'Documento', step === 'review'],
              ['3', 'Revision', false]
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
              <h2 className="font-display text-lg font-bold text-brand-primary">Ingresa con tu cedula</h2>
              <label className="mt-5 block space-y-1 text-sm font-semibold text-slate-700">
                <span>Cedula o RIF</span>
                <input
                  type="text"
                  value={identity}
                  onBlur={() => setIdentityTouched(true)}
                  onChange={(event) => setIdentity(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm uppercase text-slate-900 outline-none transition focus:border-brand-secondary"
                  placeholder="Ej. V12345678"
                />
              </label>
              {identityTouched && !identityIsValid ? (
                <p className="mt-2 text-sm font-medium text-rose-700">Ingresa una cedula o RIF valido.</p>
              ) : null}
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={handleLogin}
                  className={`btn-primary ${!identityIsValid ? 'cursor-not-allowed opacity-50' : ''}`}
                  disabled={!identityIsValid}
                >
                  Continuar
                </button>
              </div>
            </div>
          ) : null}

          {step === 'upload' ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-display text-lg font-bold text-brand-primary">Carga el documento del vehiculo</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Puedes cargar certificado de origen o carnet de circulacion en PDF, PNG o JPG.
                  </p>
                </div>
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
                  {uploadedFile ? uploadedFile.name : 'Certificado de origen o carnet de circulacion'}
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

          {step === 'review' ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-display text-lg font-bold text-brand-primary">Revisa la informacion detectada</h2>
                </div>
                <button type="button" onClick={handleResetDocument} className="btn-secondary">
                  Cambiar documento
                </button>
              </div>

              <div className="mt-5 rounded-xl border border-brand-light bg-brand-light/50 px-4 py-3 text-sm text-brand-primary">
                Documento detectado: <strong>{documentTypeLabel[vehicleData.documentType]}</strong>
                {uploadedFile ? <span className="text-slate-500"> · {uploadedFile.name}</span> : null}
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Titular</span>
                  <input value={vehicleData.ownerName} onChange={(event) => updateField('ownerName', event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-secondary" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Cedula/RIF</span>
                  <input value={vehicleData.ownerId} onChange={(event) => updateField('ownerId', event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase outline-none focus:border-brand-secondary" />
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
                  <input value={vehicleData.brand} onChange={(event) => updateField('brand', event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-secondary" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Modelo</span>
                  <input value={vehicleData.model} onChange={(event) => updateField('model', event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-secondary" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Ano</span>
                  <input value={vehicleData.year} onChange={(event) => updateField('year', event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-secondary" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Color</span>
                  <input value={vehicleData.color} onChange={(event) => updateField('color', event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-secondary" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-slate-700">
                  <span>Uso</span>
                  <select value={vehicleData.useType} onChange={(event) => updateField('useType', event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-secondary">
                    <option>Particular</option>
                    <option>Comercial</option>
                    <option>Carga</option>
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
                  onClick={() => setStep('upload')}
                  disabled={!canFinish}
                  className={`btn-primary ${!canFinish ? 'cursor-not-allowed opacity-50' : ''}`}
                >
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
