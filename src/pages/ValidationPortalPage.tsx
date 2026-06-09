import { ChangeEvent, useMemo, useRef, useState } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import exampleInsuranceLogoWhite from '../brand/Marca_example/logos/svg/example_insurance_white.svg';
import exampleInsuranceLogoWhitePng from '../brand/Marca_example/logos/png/example_insurance_white.png';

type FlowStep = 'login' | 'upload' | 'json' | 'quote';
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

interface PolicyQuote {
  quoteId: string;
  insurer: string;
  planName: string;
  status: 'approved' | 'review';
  currency: 'USD';
  annualPremium: number;
  monthlyPremium: number;
  deductible: number;
  liabilityLimit: number;
  coverage: string[];
  validUntil: string;
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

const formatCurrency = (currency: string, value: number) => `${currency} ${value.toFixed(2)}`;
const safePdfText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

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

const requestPolicyQuote = async (quoteRequest: unknown, vehicle: VehicleData): Promise<PolicyQuote> => {
  await new Promise((resolve) => window.setTimeout(resolve, 900));

  const vehicleYear = Number(vehicle.year);
  const currentYear = new Date().getFullYear();
  const age = Number.isFinite(vehicleYear) ? Math.max(0, currentYear - vehicleYear) : 5;
  const useFactor = vehicle.useType === 'COMERCIAL' ? 1.28 : vehicle.useType === 'CARGA' ? 1.45 : 1;
  const ageFactor = age <= 2 ? 1.18 : age <= 8 ? 1 : 0.88;
  const basePremium = 420;
  const annualPremium = Math.round(basePremium * useFactor * ageFactor);
  const quoteSeed = JSON.stringify(quoteRequest).length + vehicle.vin.length + vehicle.ownerId.length;

  return {
    quoteId: `AUTO-${new Date().getFullYear()}-${String(quoteSeed).padStart(5, '0')}`,
    insurer: 'Example Insurance',
    planName: vehicle.useType === 'COMERCIAL' ? 'Auto Comercial Integral' : 'Auto Proteccion Integral',
    status: 'approved',
    currency: 'USD',
    annualPremium,
    monthlyPremium: Math.round((annualPremium / 12) * 100) / 100,
    deductible: vehicle.useType === 'CARGA' ? 350 : 250,
    liabilityLimit: vehicle.useType === 'CARGA' ? 30000 : 20000,
    coverage: ['Responsabilidad civil', 'Perdida total', 'Danos a terceros', 'Asistencia vial'],
    validUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 15).toISOString().slice(0, 10)
  };
};

const generateQuotePdf = async (quote: PolicyQuote, vehicle: VehicleData, requestPayload: unknown) => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const { height } = page.getSize();
  const primary = rgb(0.08, 0.07, 0.18);
  const accent = rgb(0.32, 0.08, 0.76);
  const muted = rgb(0.35, 0.39, 0.47);
  let y = height - 54;

  const drawText = (text: string, x: number, textY: number, size = 10, bold = false, color = primary) => {
    page.drawText(safePdfText(text), { x, y: textY, size, font: bold ? boldFont : font, color });
  };

  const drawRow = (label: string, value: string, x: number, rowY: number) => {
    drawText(label, x, rowY, 8, true, muted);
    drawText(value || '-', x, rowY - 14, 11, false, primary);
  };

  page.drawRectangle({ x: 0, y: height - 106, width: 612, height: 106, color: primary });
  try {
    const logoBytes = await fetch(exampleInsuranceLogoWhitePng).then((response) => response.arrayBuffer());
    const logo = await pdfDoc.embedPng(logoBytes);
    const logoSize = logo.scale(0.18);
    page.drawImage(logo, { x: 48, y: height - 60, width: logoSize.width, height: logoSize.height });
  } catch {
    drawText('Example Insurance', 48, height - 48, 22, true, rgb(1, 1, 1));
  }
  drawText('Cotizacion de poliza de vehiculo', 48, height - 72, 12, false, rgb(0.88, 0.86, 0.95));
  drawText(quote.quoteId, 456, height - 48, 13, true, rgb(1, 1, 1));
  drawText(`Valida hasta ${quote.validUntil}`, 456, height - 68, 9, false, rgb(0.88, 0.86, 0.95));

  y -= 124;
  drawText('Resumen de cotizacion', 48, y, 16, true, primary);
  page.drawRectangle({ x: 48, y: y - 88, width: 516, height: 70, color: rgb(0.96, 0.94, 1) });
  drawText(quote.planName, 68, y - 38, 15, true, accent);
  drawText(`${vehicle.brand} ${vehicle.model} ${vehicle.year}`, 68, y - 58, 11, false, primary);
  drawText('Prima mensual', 394, y - 36, 9, true, muted);
  drawText(formatCurrency(quote.currency, quote.monthlyPremium), 394, y - 58, 20, true, primary);

  y -= 128;
  drawText('Datos del titular', 48, y, 14, true);
  drawRow('Titular', vehicle.ownerName, 48, y - 26);
  drawRow('Cedula/RIF', vehicle.ownerId, 244, y - 26);
  drawRow('Documento fuente', documentTypeLabel[vehicle.documentType], 390, y - 26);

  y -= 88;
  drawText('Datos del vehiculo', 48, y, 14, true);
  drawRow('Marca', vehicle.brand, 48, y - 26);
  drawRow('Modelo', vehicle.model, 182, y - 26);
  drawRow('Ano', vehicle.year, 316, y - 26);
  drawRow('Color', vehicle.color, 420, y - 26);
  drawRow('Placa', vehicle.plate || 'Sin placa', 48, y - 66);
  drawRow('VIN / Serial carroceria', vehicle.vin, 182, y - 66);
  drawRow('Serial motor', vehicle.engineSerial, 390, y - 66);

  y -= 136;
  drawText('Montos y cobertura', 48, y, 14, true);
  page.drawLine({ start: { x: 48, y: y - 12 }, end: { x: 564, y: y - 12 }, thickness: 1, color: rgb(0.86, 0.88, 0.92) });
  [
    ['Prima anual', formatCurrency(quote.currency, quote.annualPremium)],
    ['Prima mensual', formatCurrency(quote.currency, quote.monthlyPremium)],
    ['Deducible', formatCurrency(quote.currency, quote.deductible)],
    ['Limite RC', `${quote.currency} ${quote.liabilityLimit.toLocaleString('en-US')}`]
  ].forEach(([label, value], index) => {
    const rowY = y - 38 - index * 26;
    drawText(label, 60, rowY, 10, false, muted);
    drawText(value, 420, rowY, 10, true, primary);
  });

  y -= 152;
  drawText('Coberturas incluidas', 48, y, 14, true);
  quote.coverage.forEach((item, index) => {
    drawText(`- ${item}`, 60, y - 26 - index * 18, 10, false, primary);
  });

  drawText('Documento generado para fines demostrativos. Los montos son dummies y deben validarse con el API real de cotizacion.', 48, 72, 8, false, muted);
  drawText(`Payload tecnico: ${JSON.stringify(requestPayload).slice(0, 170)}...`, 48, 54, 7, false, muted);

  return pdfDoc.save();
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
  const [isRequestingQuote, setIsRequestingQuote] = useState(false);
  const [quote, setQuote] = useState<PolicyQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const normalizedIdentity = storedIdentity || normalizeId(identityPrefix, identity);
  const identityIsValid = isValidIdentity(identity);
  const canLogin = identityIsValid && password.trim().length > 0;
  const hasExtractedDocument = Boolean(uploadedFile && extractionMeta.documentValid);
  const validationErrors = useMemo(() => validateVehicleData(vehicleData), [vehicleData]);
  const canContinue = hasExtractedDocument && validationErrors.length === 0;

  const finalJson = useMemo(
    () => ({
      action: 'request_vehicle_policy_quote',
      applicant: {
        identity: vehicleData.ownerId || normalizedIdentity,
        name: vehicleData.ownerName
      },
      document: {
        type: vehicleData.documentType,
        label: documentTypeLabel[vehicleData.documentType],
        fileName: uploadedFile?.name ?? null,
        valid: extractionMeta.documentValid,
        confidence: extractionMeta.confidence,
        missingFields: extractionMeta.missingFields,
        messages: extractionMeta.messages
      },
      vehicle: vehicleData,
      quote: {
        product: 'auto_policy',
        requestedCoverage: 'full',
        paymentFrequency: 'monthly'
      }
    }),
    [extractionMeta, normalizedIdentity, uploadedFile?.name, vehicleData]
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
    setQuote(null);
    setQuoteError('');
    setIsRequestingQuote(false);
    setIsGeneratingPdf(false);
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
    setQuote(null);
    setQuoteError('');
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

  const handleRequestQuote = async () => {
    if (!canContinue) return;
    setIsRequestingQuote(true);
    setQuoteError('');

    try {
      const requestedQuote = await requestPolicyQuote(finalJson, vehicleData);
      setQuote(requestedQuote);
      setStep('quote');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo solicitar la cotizacion.';
      setQuoteError(message);
    } finally {
      setIsRequestingQuote(false);
    }
  };

  const handleDownloadQuotePdf = async () => {
    if (!quote) return;
    setIsGeneratingPdf(true);
    setQuoteError('');

    try {
      const pdfBytes = await generateQuotePdf(quote, vehicleData, finalJson);
      const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
      new Uint8Array(pdfBuffer).set(pdfBytes);
      const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cotizacion-${quote.quoteId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo generar el PDF.';
      setQuoteError(message);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <section className="container-app py-8 sm:py-10">
      <div className="mt-6 grid gap-5 lg:grid-cols-[280px,1fr]">
        <aside className="rounded-2xl border border-white/10 bg-brand-primary/70 p-4 text-white shadow-card">
          <div className="space-y-3">
            {[
              ['1', 'Documento', step === 'json' || step === 'quote'],
              ['2', 'Solicitud', step === 'quote'],
              ['3', 'Cotizacion', step === 'quote']
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
                  disabled={!canContinue}
                  className={`btn-primary ${!canContinue ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  Siguiente
                </button>
              </div>
            </div>
          ) : null}

          {step === 'json' ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
              <h2 className="font-display text-lg font-bold text-brand-primary">Solicitud de cotizacion</h2>

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

              <pre className="mt-5 max-h-[420px] overflow-auto rounded-xl bg-brand-primary p-4 text-xs leading-6 text-brand-light">
                {JSON.stringify(finalJson, null, 2)}
              </pre>
              {quoteError ? <p className="mt-3 text-sm font-medium text-rose-700">{quoteError}</p> : null}
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={handleRequestQuote}
                  disabled={isRequestingQuote}
                  className={`btn-primary ${isRequestingQuote ? 'cursor-not-allowed opacity-70' : ''}`}
                >
                  {isRequestingQuote ? 'Enviando solicitud...' : 'Enviar solicitud'}
                </button>
              </div>
            </div>
          ) : null}

          {step === 'quote' && quote ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
              <div className="mx-auto max-w-4xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
                <div className="bg-brand-primary px-6 py-6 text-white sm:px-8">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <img src={exampleInsuranceLogoWhite} alt="Example Insurance" className="h-12 w-auto" />
                      <h2 className="mt-1 font-display text-2xl font-bold">Cotizacion de poliza de vehiculo</h2>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-sm font-bold">{quote.quoteId}</p>
                      <p className="mt-1 text-xs font-medium text-white/70">Valida hasta {quote.validUntil}</p>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-6 sm:px-8">
                  <div className="grid gap-5 border-b border-slate-200 pb-6 md:grid-cols-[1.2fr,0.8fr]">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-brand-secondary">Plan cotizado</p>
                      <h3 className="mt-1 font-display text-2xl font-bold text-brand-primary">{quote.planName}</h3>
                      <p className="mt-3 text-sm text-slate-600">
                        {vehicleData.brand} {vehicleData.model} {vehicleData.year} · VIN {vehicleData.vin}
                      </p>
                      <span className="mt-4 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                        Aprobada
                      </span>
                    </div>
                    <div className="rounded-lg border border-brand-light bg-brand-light/40 p-4">
                      <p className="text-sm font-semibold text-slate-500">Prima mensual</p>
                      <p className="mt-1 font-display text-3xl font-bold text-brand-primary">
                        {formatCurrency(quote.currency, quote.monthlyPremium)}
                      </p>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        Prima anual {formatCurrency(quote.currency, quote.annualPremium)}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-8 py-6 md:grid-cols-2">
                    <div>
                      <h4 className="font-display text-base font-bold text-brand-primary">Datos del titular</h4>
                      <dl className="mt-4 space-y-3 text-sm">
                        <div>
                          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Titular</dt>
                          <dd className="mt-1 font-semibold text-slate-900">{vehicleData.ownerName || '-'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Cedula/RIF</dt>
                          <dd className="mt-1 font-semibold text-slate-900">{vehicleData.ownerId || '-'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Documento fuente</dt>
                          <dd className="mt-1 font-semibold text-slate-900">{documentTypeLabel[vehicleData.documentType]}</dd>
                        </div>
                      </dl>
                    </div>

                    <div>
                      <h4 className="font-display text-base font-bold text-brand-primary">Datos del vehiculo</h4>
                      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Marca</dt>
                          <dd className="mt-1 font-semibold text-slate-900">{vehicleData.brand || '-'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Modelo</dt>
                          <dd className="mt-1 font-semibold text-slate-900">{vehicleData.model || '-'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Ano</dt>
                          <dd className="mt-1 font-semibold text-slate-900">{vehicleData.year || '-'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Color</dt>
                          <dd className="mt-1 font-semibold text-slate-900">{vehicleData.color || '-'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Placa</dt>
                          <dd className="mt-1 font-semibold text-slate-900">{vehicleData.plate || 'Sin placa'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Serial motor</dt>
                          <dd className="mt-1 break-all font-semibold text-slate-900">{vehicleData.engineSerial || '-'}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>

                  <div className="grid gap-6 border-t border-slate-200 pt-6 md:grid-cols-[0.9fr,1.1fr]">
                    <div>
                      <h4 className="font-display text-base font-bold text-brand-primary">Montos</h4>
                      <dl className="mt-4 space-y-3 text-sm">
                        <div className="flex justify-between gap-4">
                          <dt className="text-slate-500">Prima anual</dt>
                          <dd className="font-bold text-slate-900">{formatCurrency(quote.currency, quote.annualPremium)}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-slate-500">Prima mensual</dt>
                          <dd className="font-bold text-slate-900">{formatCurrency(quote.currency, quote.monthlyPremium)}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-slate-500">Deducible</dt>
                          <dd className="font-bold text-slate-900">{formatCurrency(quote.currency, quote.deductible)}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-slate-500">Limite RC</dt>
                          <dd className="font-bold text-slate-900">{quote.currency} {quote.liabilityLimit.toLocaleString('en-US')}</dd>
                        </div>
                      </dl>
                    </div>

                    <div>
                      <h4 className="font-display text-base font-bold text-brand-primary">Coberturas incluidas</h4>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {quote.coverage.map((item) => (
                          <span key={item} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <p className="mt-6 border-t border-slate-200 pt-4 text-xs font-medium text-slate-500">
                    Documento generado para fines demostrativos. Los montos son dummies y deben validarse con el API real de cotizacion.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleDownloadQuotePdf}
                  disabled={isGeneratingPdf}
                  className={`btn-secondary ${isGeneratingPdf ? 'cursor-not-allowed opacity-70' : ''}`}
                >
                  {isGeneratingPdf ? 'Exportando...' : 'Exportar'}
                </button>
                <button type="button" onClick={handleResetDocument} className="btn-primary">
                  Nueva cotizacion
                </button>
              </div>
              {quoteError ? <p className="mt-3 text-right text-sm font-medium text-rose-700">{quoteError}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};

export default ValidationPortalPage;
