import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import UploadCard from '../components/validation/UploadCard';
import { documentSlotsSeed } from '../mocks/documents';
import { compareExpedient, validateDocuments, validateImages } from '../services/api';
import { CompareExpedientResponse, SlotExtraction } from '../types/api';
import { DocumentType, UploadedDocument } from '../types/validation';

const resetDocument = (doc: UploadedDocument): UploadedDocument => ({
  ...doc,
  file: null,
  fileName: null,
  status: 'pending',
  errorMessage: null
});

const DOCUMENT_SLOTS: Array<Extract<DocumentType, 'invoice' | 'certificate_of_origin'>> = ['certificate_of_origin', 'invoice'];
const IMAGE_SLOTS: Array<Extract<DocumentType, 'photo_plate' | 'photo_serial'>> = ['photo_plate', 'photo_serial'];
const EXPEDIENT_ID = 'EXP-LOGISTICA-001';

const isDocumentSlot = (slot: DocumentType): slot is (typeof DOCUMENT_SLOTS)[number] =>
  DOCUMENT_SLOTS.includes(slot as (typeof DOCUMENT_SLOTS)[number]);

const isImageSlot = (slot: DocumentType): slot is (typeof IMAGE_SLOTS)[number] =>
  IMAGE_SLOTS.includes(slot as (typeof IMAGE_SLOTS)[number]);

const slotLabel: Record<DocumentType, string> = {
  invoice: 'Factura',
  certificate_of_origin: 'Certificado de origen',
  photo_plate: 'Fotoplaca',
  photo_serial: 'Fotoserial'
};
const extractionDisplayOrder: DocumentType[] = ['certificate_of_origin', 'invoice', 'photo_plate', 'photo_serial'];

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

const areEquivalentWithOcrNoise = (a?: string | null, b?: string | null): boolean => {
  if (!a || !b) return false;
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

const ValidationPortalPage = () => {
  const [flowStep, setFlowStep] = useState<1 | 2 | 3>(1);
  const [agentFirstName, setAgentFirstName] = useState('');
  const [agentLastName, setAgentLastName] = useState('');
  const [documents, setDocuments] = useState<UploadedDocument[]>(documentSlotsSeed);
  const [rawExtractions, setRawExtractions] = useState<Partial<Record<DocumentType, SlotExtraction>>>({});

  const [uploadingBySlot, setUploadingBySlot] = useState<Record<DocumentType, boolean>>({
    invoice: false,
    certificate_of_origin: false,
    photo_plate: false,
    photo_serial: false
  });
  const [phaseLoading, setPhaseLoading] = useState({
    validateDocuments: false,
    validateImages: false,
    compare: false
  });
  const [phaseErrors, setPhaseErrors] = useState({
    upload: '',
    validateDocuments: '',
    validateImages: '',
    compare: ''
  });
  const [phaseCompleted, setPhaseCompleted] = useState({
    validateDocuments: false,
    validateImages: false
  });
  const [compareResult, setCompareResult] = useState<CompareExpedientResponse | null>(null);
  const [sendingToDana, setSendingToDana] = useState(false);

  const filesBySlot = useMemo(
    () =>
      Object.fromEntries(documents.filter((d) => d.file).map((d) => [d.type, d.file as File])) as Partial<
        Record<DocumentType, File>
      >,
    [documents]
  );
  const orderedDocumentsForExtraction = useMemo(() => {
    const byType = Object.fromEntries(documents.map((doc) => [doc.type, doc])) as Partial<Record<DocumentType, UploadedDocument>>;
    return extractionDisplayOrder.map((type) => byType[type]).filter((doc): doc is UploadedDocument => Boolean(doc));
  }, [documents]);
  const visibleDocumentsForExtraction = useMemo(
    () =>
      orderedDocumentsForExtraction.filter((doc) =>
        isDocumentSlot(doc.type) ? phaseCompleted.validateDocuments : phaseCompleted.validateImages
      ),
    [orderedDocumentsForExtraction, phaseCompleted.validateDocuments, phaseCompleted.validateImages]
  );

  const canContinueToValidation = agentFirstName.trim().length > 0 && agentLastName.trim().length > 0;

  const canValidateDocuments = useMemo(
    () =>
      DOCUMENT_SLOTS.every((slot) => Boolean(filesBySlot[slot])) &&
      !phaseLoading.validateDocuments &&
      !phaseLoading.validateImages &&
      !phaseLoading.compare,
    [filesBySlot, phaseLoading.compare, phaseLoading.validateDocuments, phaseLoading.validateImages]
  );

  const canValidateImages = useMemo(
    () =>
      IMAGE_SLOTS.every((slot) => Boolean(filesBySlot[slot])) &&
      !phaseLoading.validateImages &&
      !phaseLoading.validateDocuments &&
      !phaseLoading.compare,
    [filesBySlot, phaseLoading.compare, phaseLoading.validateDocuments, phaseLoading.validateImages]
  );

  const canResetRecord =
    !phaseLoading.validateDocuments && !phaseLoading.validateImages && !phaseLoading.compare && !sendingToDana;

  const handleResetRecord = () => {
    if (!canResetRecord) return;
    setDocuments((prev) => prev.map((doc) => resetDocument(doc)));
    setRawExtractions({});
    setCompareResult(null);
    setPhaseCompleted({
      validateDocuments: false,
      validateImages: false
    });
    setPhaseErrors({
      upload: '',
      validateDocuments: '',
      validateImages: '',
      compare: ''
    });
    setUploadingBySlot({
      invoice: false,
      certificate_of_origin: false,
      photo_plate: false,
      photo_serial: false
    });
    if (flowStep === 3) {
      setFlowStep(2);
    }
  };

  const handleStartNewExpedient = () => {
    if (!canResetRecord) return;
    setFlowStep(canContinueToValidation ? 2 : 1);
    setDocuments((prev) => prev.map((doc) => resetDocument(doc)));
    setRawExtractions({});
    setCompareResult(null);
    setPhaseCompleted({
      validateDocuments: false,
      validateImages: false
    });
    setPhaseErrors({
      upload: '',
      validateDocuments: '',
      validateImages: '',
      compare: ''
    });
    setUploadingBySlot({
      invoice: false,
      certificate_of_origin: false,
      photo_plate: false,
      photo_serial: false
    });
  };

  const setDocumentStatus = (slot: DocumentType, patch: Partial<UploadedDocument>) => {
    setDocuments((prev) => prev.map((doc) => (doc.type === slot ? { ...doc, ...patch } : doc)));
  };

  const updateDocumentsFromExtractions = (extractions: Partial<Record<DocumentType, SlotExtraction>>) => {
    setDocuments((prev) =>
      prev.map((doc) => {
        const extraction = extractions[doc.type];
        if (!extraction || !doc.file) {
          return doc;
        }
        return {
          ...doc,
          status: extraction.document_valid ? 'validated' : 'error',
          errorMessage: extraction.document_valid ? null : extraction.reason ?? 'Documento inválido.'
        };
      })
    );
  };

  const handleCompareExpedient = async (mergedExtractions: Partial<Record<DocumentType, SlotExtraction>>) => {
    setPhaseLoading((prev) => ({ ...prev, compare: true }));
    setPhaseErrors((prev) => ({ ...prev, compare: '' }));
    try {
      const response = await compareExpedient(EXPEDIENT_ID, mergedExtractions);
      setCompareResult(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error no controlado en comparación.';
      setPhaseErrors((prev) => ({ ...prev, compare: message }));
      setCompareResult(null);
    } finally {
      setPhaseLoading((prev) => ({ ...prev, compare: false }));
    }
  };

  const handleSelectFile = (type: DocumentType, file: File) => {
    setPhaseErrors((prev) => ({ ...prev, upload: '' }));
    setCompareResult(null);
    if (flowStep === 3) setFlowStep(2);
    setUploadingBySlot((prev) => ({ ...prev, [type]: true }));
    setDocumentStatus(type, {
      file,
      fileName: file.name,
      status: 'uploaded',
      errorMessage: null
    });
    setRawExtractions((prev) => {
      const next = { ...prev };
      delete next[type];
      return next;
    });
    setPhaseCompleted((prev) => ({
      validateDocuments: isDocumentSlot(type) ? false : prev.validateDocuments,
      validateImages: isImageSlot(type) ? false : prev.validateImages
    }));
    setUploadingBySlot((prev) => ({ ...prev, [type]: false }));
  };

  const handleClearFile = (type: DocumentType) => {
    setCompareResult(null);
    if (flowStep === 3) setFlowStep(2);
    setRawExtractions((prev) => {
      const next = { ...prev };
      delete next[type];
      return next;
    });
    setPhaseCompleted((prev) => ({
      validateDocuments: isDocumentSlot(type) ? false : prev.validateDocuments,
      validateImages: isImageSlot(type) ? false : prev.validateImages
    }));
    setDocuments((prev) => prev.map((doc) => (doc.type === type ? resetDocument(doc) : doc)));
  };

  const canSendToDana =
    phaseCompleted.validateDocuments &&
    phaseCompleted.validateImages &&
    Boolean(compareResult) &&
    Boolean(compareResult?.cross_validation) &&
    compareResult?.cross_validation?.serial_match === true &&
    !phaseLoading.validateDocuments &&
    !phaseLoading.validateImages &&
    !phaseLoading.compare &&
    !sendingToDana;

  const serialBlockedReason = useMemo(() => {
    if (!phaseCompleted.validateDocuments || !phaseCompleted.validateImages || !compareResult) {
      return '';
    }
    if (compareResult.cross_validation?.serial_match === true) {
      return '';
    }
    const certificateSerial = normalizeSerial(rawExtractions.certificate_of_origin?.serial);
    const invoiceSerial = normalizeSerial(rawExtractions.invoice?.serial);
    const photoSerial = normalizeSerial(rawExtractions.photo_serial?.serial);

    if (!certificateSerial) {
      return 'No se pudo detectar serial de referencia en el certificado de origen.';
    }
    if (!invoiceSerial) {
      return 'No se pudo detectar serial en la factura.';
    }
    if (!photoSerial) {
      return 'No se pudo detectar serial en el fotoserial.';
    }
    if (!areEquivalentWithOcrNoise(invoiceSerial, certificateSerial)) {
      return 'El serial de la factura no coincide con el serial del certificado de origen.';
    }
    if (!areEquivalentWithOcrNoise(photoSerial, certificateSerial)) {
      return 'El serial de la foto no coincide con el serial del certificado de origen.';
    }
    return 'Los seriales no coinciden con la referencia del certificado de origen.';
  }, [compareResult, phaseCompleted.validateDocuments, phaseCompleted.validateImages, rawExtractions]);

  const isSummaryValidated =
    compareResult?.cross_validation?.plate_match === true && compareResult?.cross_validation?.serial_match === true;

  const handleSendToDanaDemo = async () => {
    if (!canSendToDana || !compareResult) return;

    setSendingToDana(true);
    try {
      const danaPayload = {
        destination: 'DANA_DEMO',
        sent_at: new Date().toISOString(),
        expedient_id: EXPEDIENT_ID,
        agent: {
          first_name: agentFirstName.trim(),
          last_name: agentLastName.trim()
        },
        requested_extractions: {
          certificate_of_origin: {
            plate: rawExtractions.certificate_of_origin?.plate ?? null,
            serial: rawExtractions.certificate_of_origin?.serial ?? null
          },
          invoice: {
            plate: rawExtractions.invoice?.plate ?? null,
            serial: rawExtractions.invoice?.serial ?? null
          },
          photo_plate: {
            plate: rawExtractions.photo_plate?.plate ?? null
          },
          photo_serial: {
            serial: rawExtractions.photo_serial?.serial ?? null
          }
        },
        validation_summary: {
          overall_status: compareResult.overall_status ?? 'manual_review',
          document_validation: compareResult.document_validation ?? {},
          cross_validation: compareResult.cross_validation ?? {},
          messages: compareResult.messages ?? []
        }
      };

      // Demo: simula envío y deja payload visible en consola para inspección.
      await new Promise((resolve) => setTimeout(resolve, 900));
      console.info('DANA demo payload', danaPayload);
      setFlowStep(3);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo enviar a DANA.';
      setPhaseErrors((prev) => ({ ...prev, compare: `Error en envío demo: ${message}` }));
    } finally {
      setSendingToDana(false);
    }
  };

  const handleValidateDocuments = async (): Promise<boolean> => {
    if (!canValidateDocuments || phaseLoading.validateImages) return false;

    setPhaseLoading((prev) => ({ ...prev, validateDocuments: true }));
    setPhaseErrors((prev) => ({ ...prev, validateDocuments: '' }));
    try {
      const response = await validateDocuments(EXPEDIENT_ID, {
        invoice: filesBySlot.invoice as File,
        certificate_of_origin: filesBySlot.certificate_of_origin as File
      });
      const phaseExtractions = response.frontend_required ?? response.raw_extractions ?? {};
      const mergedExtractions = { ...rawExtractions, ...phaseExtractions };
      setRawExtractions(mergedExtractions);
      updateDocumentsFromExtractions(phaseExtractions);
      setPhaseCompleted((prev) => ({ ...prev, validateDocuments: true }));
      if (phaseCompleted.validateImages) {
        await handleCompareExpedient(mergedExtractions);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error no controlado en validación documental.';
      setPhaseErrors((prev) => ({ ...prev, validateDocuments: message }));
      return false;
    } finally {
      setPhaseLoading((prev) => ({ ...prev, validateDocuments: false }));
    }
  };

  const handleValidateImages = async (): Promise<boolean> => {
    if (!canValidateImages || phaseLoading.validateDocuments) return false;

    setPhaseLoading((prev) => ({ ...prev, validateImages: true }));
    setPhaseErrors((prev) => ({ ...prev, validateImages: '' }));
    try {
      const response = await validateImages(EXPEDIENT_ID, {
        photo_plate: filesBySlot.photo_plate as File,
        photo_serial: filesBySlot.photo_serial as File
      }, {
        referenceSerial: rawExtractions.certificate_of_origin?.serial ?? undefined
      });
      const phaseExtractions = response.frontend_required ?? response.raw_extractions ?? {};
      const mergedExtractions = { ...rawExtractions, ...phaseExtractions };
      setRawExtractions(mergedExtractions);
      updateDocumentsFromExtractions(phaseExtractions);
      setPhaseCompleted((prev) => ({ ...prev, validateImages: true }));
      if (phaseCompleted.validateDocuments) {
        await handleCompareExpedient(mergedExtractions);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error no controlado en validación de imágenes.';
      setPhaseErrors((prev) => ({ ...prev, validateImages: message }));
      return false;
    } finally {
      setPhaseLoading((prev) => ({ ...prev, validateImages: false }));
    }
  };

  const handleEnterShortcut = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      if (event.defaultPrevented || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;

      const target = event.target as HTMLElement | null;
      if (!target) return;
      const tagName = target.tagName.toLowerCase();
      const inputType = target instanceof HTMLInputElement ? target.type : '';
      if (tagName === 'textarea' || target.isContentEditable) return;
      if (tagName === 'button' || tagName === 'a' || inputType === 'file') return;

      if (flowStep === 1) {
        if (!canContinueToValidation) return;
        event.preventDefault();
        setFlowStep(2);
        return;
      }

      if (flowStep === 2) {
        if (phaseLoading.validateDocuments || phaseLoading.validateImages || phaseLoading.compare || sendingToDana) return;

        if (canValidateDocuments) {
          event.preventDefault();
          void handleValidateDocuments();
          return;
        }

        if (phaseCompleted.validateDocuments && canValidateImages) {
          event.preventDefault();
          void handleValidateImages();
          return;
        }

        if (canSendToDana) {
          event.preventDefault();
          void handleSendToDanaDemo();
        }
      }
    },
    [
      canContinueToValidation,
      canSendToDana,
      canValidateDocuments,
      canValidateImages,
      flowStep,
      handleSendToDanaDemo,
      phaseCompleted.validateDocuments,
      phaseLoading.compare,
      phaseLoading.validateDocuments,
      phaseLoading.validateImages,
      sendingToDana,
      handleValidateDocuments,
      handleValidateImages
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleEnterShortcut);
    return () => window.removeEventListener('keydown', handleEnterShortcut);
  }, [handleEnterShortcut]);

  const renderUploadGrid = (slots: UploadedDocument[]) => (
    <div className="grid gap-4 md:grid-cols-2">
      {slots.map((document) => {
        const isUploading = uploadingBySlot[document.type];
        const isPhaseValidating =
          (phaseLoading.validateDocuments && isDocumentSlot(document.type)) ||
          (phaseLoading.validateImages && isImageSlot(document.type));
        const missingPairText =
          document.type === 'invoice' && document.file
            ? filesBySlot.certificate_of_origin
              ? ''
              : 'Esperando Certificado de origen para iniciar validación documental.'
            : document.type === 'certificate_of_origin' && document.file
              ? filesBySlot.invoice
                ? ''
                : 'Esperando Factura para iniciar validación documental.'
              : document.type === 'photo_plate' && document.file
                ? filesBySlot.photo_serial
                  ? ''
                  : 'Esperando Fotoserial para iniciar validación de imágenes.'
                : document.type === 'photo_serial' && document.file
                  ? filesBySlot.photo_plate
                    ? ''
                    : 'Esperando Fotoplaca para iniciar validación de imágenes.'
                  : '';
        const activityText = isUploading
          ? `Subiendo ${slotLabel[document.type]}...`
          : isPhaseValidating
            ? `Validando ${slotLabel[document.type]}...`
            : '';

        return (
          <UploadCard
            key={document.type}
            document={document}
            onSelectFile={handleSelectFile}
            onClear={handleClearFile}
            isValidating={Boolean(activityText)}
            activityText={activityText}
            helperText={missingPairText}
          />
        );
      })}
    </div>
  );

  return (
    <section className="container-app py-8 sm:py-10">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 px-1">
          <div>
            <h1 className="font-display text-xl font-bold text-white sm:text-2xl">Validación logística de expediente</h1>
            <p className="mt-1 text-sm text-slate-200">Control de documentos y evidencias de motocicleta.</p>
          </div>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-xl bg-brand-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-secondaryStrong"
          >
            Salir
          </Link>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {flowStep === 1 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
            <h2 className="font-display text-lg font-bold text-brand-secondary">Datos del agente</h2>
            <p className="mt-1 text-sm text-slate-600">Ingrese nombre y apellido para iniciar la validación del expediente.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Nombre</span>
                <input
                  type="text"
                  value={agentFirstName}
                  onChange={(event) => setAgentFirstName(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-brand-primary"
                  placeholder="Ej. María"
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Apellido</span>
                <input
                  type="text"
                  value={agentLastName}
                  onChange={(event) => setAgentLastName(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-brand-primary"
                  placeholder="Ej. Lastra"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setFlowStep(2)}
                disabled={!canContinueToValidation}
                className={`btn-primary ${!canContinueToValidation ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                Siguiente
              </button>
            </div>
          </div>
        ) : null}

        {flowStep >= 2 ? (
          <>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600">Validación de expediente</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600">
                    Agente: {agentFirstName} {agentLastName}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2"></div>
              </div>

              {phaseErrors.upload ? <p className="mt-2 text-sm text-rose-700">Error de carga: {phaseErrors.upload}</p> : null}
              {phaseErrors.validateDocuments ? (
                <p className="mt-2 text-sm text-rose-700">Error validando documentos: {phaseErrors.validateDocuments}</p>
              ) : null}
              {phaseErrors.validateImages ? (
                <p className="mt-2 text-sm text-rose-700">Error validando imágenes: {phaseErrors.validateImages}</p>
              ) : null}
              {phaseErrors.compare ? <p className="mt-2 text-sm text-rose-700">Error comparando expediente: {phaseErrors.compare}</p> : null}
            </div>

            {flowStep === 2 ? (
              <>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-lg font-bold text-brand-secondary">Documentos</h3>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleResetRecord}
                        disabled={!canResetRecord}
                        className={`rounded-xl bg-brand-accent px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-secondaryStrong ${
                          !canResetRecord ? 'cursor-not-allowed opacity-50' : ''
                        }`}
                      >
                        Limpiar registro
                      </button>
                      <button
                        type="button"
                        onClick={handleValidateDocuments}
                        disabled={!canValidateDocuments}
                        className={`btn-primary ${!canValidateDocuments ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        {phaseLoading.validateDocuments ? 'Validando documentos...' : 'Validar documentos'}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-900">
                    Cargue <strong>Factura</strong> y <strong>Certificado de origen</strong>. Cuando ambos estén cargados,
                    presione <strong>Validar documentos</strong>.
                  </div>
                  <div className="mt-4">
                    {renderUploadGrid(
                      DOCUMENT_SLOTS.map((slot) => documents.find((doc) => doc.type === slot)).filter(
                        (doc): doc is UploadedDocument => Boolean(doc)
                      )
                    )}
                  </div>
                </div>

                {phaseCompleted.validateDocuments ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-lg font-bold text-brand-secondary">Imágenes</h3>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={handleValidateImages}
                          disabled={!canValidateImages}
                          className={`btn-primary ${!canValidateImages ? 'cursor-not-allowed opacity-50' : ''}`}
                        >
                          {phaseLoading.validateImages ? 'Validando imágenes...' : 'Validar imágenes'}
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-900">
                      Cargue <strong>Fotoplaca</strong> y <strong>Fotoserial</strong>. Cuando ambas estén cargadas, presione
                      <strong> Validar imágenes</strong>.
                    </div>
                    <div className="mt-4">{renderUploadGrid(documents.filter((doc) => isImageSlot(doc.type)))}</div>
                  </div>
                ) : null}
              </>
            ) : null}

            {flowStep === 2 && visibleDocumentsForExtraction.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
                <h3 className="font-display text-lg font-bold text-brand-secondary">Extracción detectada</h3>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  {visibleDocumentsForExtraction.map((doc) => {
                    const extraction = rawExtractions[doc.type];
                    const plate = extraction?.plate ?? null;
                    const serial = extraction?.serial ?? null;
                    const isDetected = Boolean(extraction?.document_valid);
                    const invoiceRef = rawExtractions.invoice;
                    const certificateRef = rawExtractions.certificate_of_origin;
                    const invoicePlate = normalizePlate(invoiceRef?.plate);
                    const certificatePlate = normalizePlate(certificateRef?.plate);
                    const invoiceSerial = normalizeSerial(invoiceRef?.serial);
                    const certificateSerial = normalizeSerial(certificateRef?.serial);
                    const referencePlate = certificatePlate;
                    const referenceSerial = certificateSerial;
                    const invoiceSerialMatchesReference =
                      Boolean(invoiceSerial) &&
                      Boolean(certificateSerial) &&
                      areEquivalentWithOcrNoise(invoiceSerial, certificateSerial);
                    const photoPlateMatchesReference =
                      Boolean(rawExtractions.photo_plate?.plate) &&
                      Boolean(referencePlate) &&
                      areEquivalentWithOcrNoise(normalizePlate(rawExtractions.photo_plate?.plate), referencePlate);

                    let statusLabel = 'Sin dato';
                    let statusClass = 'bg-slate-200 text-slate-600';
                    let cardClass = 'border-slate-200 bg-white';
                    let detailText = extraction?.reason ?? 'Aún no hay resultado de extracción para este soporte.';
                    let plateMatch: boolean | null = null;
                    let serialMatch: boolean | null = null;
                    let plateCurrentAvailable = false;
                    let serialCurrentAvailable = false;
                    let plateReferenceAvailable = false;
                    let serialReferenceAvailable = false;

                    if (doc.type === 'invoice') {
                      plateCurrentAvailable = Boolean(invoicePlate);
                      serialCurrentAvailable = Boolean(invoiceSerial);
                      plateReferenceAvailable = Boolean(certificatePlate);
                      serialReferenceAvailable = Boolean(certificateSerial);
                      plateMatch =
                        plateCurrentAvailable && plateReferenceAvailable
                          ? areEquivalentWithOcrNoise(invoicePlate, certificatePlate)
                          : null;
                      serialMatch =
                        serialCurrentAvailable && serialReferenceAvailable
                          ? areEquivalentWithOcrNoise(invoiceSerial, certificateSerial)
                          : null;
                      if (!isDetected || !invoicePlate || !invoiceSerial) {
                        if (!isDetected) {
                          statusLabel = 'Tipo inválido';
                          statusClass = 'bg-rose-100 text-rose-700';
                          cardClass = 'border-rose-200 bg-rose-50/40';
                          detailText = extraction?.reason ?? 'No corresponde al tipo documental esperado.';
                        } else {
                          const missingParts = [!invoicePlate ? 'placa' : null, !invoiceSerial ? 'serial' : null]
                            .filter(Boolean)
                            .join(' y ');
                          statusLabel = 'Dato incompleto';
                          statusClass = 'bg-amber-100 text-amber-800';
                          cardClass = 'border-amber-200 bg-amber-50/40';
                          if (!invoicePlate && invoiceSerial) {
                            detailText =
                              'No se pudo extraer la placa con suficiente confianza. Te recomendamos cargar una versión más nítida para confirmar ese dato.';
                          } else if (invoicePlate && !invoiceSerial) {
                            detailText =
                              'No se pudo extraer el serial con suficiente confianza. Te recomendamos cargar una versión más nítida para confirmar ese dato.';
                          } else {
                            detailText = `No se pudieron extraer ${missingParts} con suficiente confianza. Te recomendamos cargar una versión más nítida del documento.`;
                          }
                        }
                      } else if (!certificatePlate || !certificateSerial) {
                        statusLabel = 'Sin referencia';
                        detailText = 'Aún no hay certificado de origen con placa y serial para comparar.';
                      } else if (
                        areEquivalentWithOcrNoise(invoicePlate, certificatePlate) &&
                        areEquivalentWithOcrNoise(invoiceSerial, certificateSerial)
                      ) {
                        statusLabel = 'Coincide';
                        statusClass = 'bg-emerald-100 text-emerald-700';
                        cardClass = 'border-emerald-200 bg-emerald-50/40';
                        detailText = 'Placa y serial de factura coinciden con el certificado de origen.';
                      } else {
                        statusLabel = 'No coincide';
                        statusClass = 'bg-rose-100 text-rose-700';
                        cardClass = 'border-rose-200 bg-rose-50/40';
                        const plateMatches = areEquivalentWithOcrNoise(invoicePlate, certificatePlate);
                        const serialMatches = areEquivalentWithOcrNoise(invoiceSerial, certificateSerial);
                        detailText = `Factura vs certificado: ${
                          plateMatches ? 'placa coincide' : 'placa no coincide'
                        }, ${serialMatches ? 'serial coincide' : 'serial no coincide'}.`;
                      }
                    } else if (doc.type === 'certificate_of_origin') {
                      if (!isDetected) {
                        statusLabel = 'Tipo inválido';
                        statusClass = 'bg-rose-100 text-rose-700';
                        cardClass = 'border-rose-200 bg-rose-50/40';
                        detailText = extraction?.reason ?? 'No corresponde a certificado de origen.';
                      } else if (!plate || !serial) {
                        const missingParts = [!plate ? 'placa' : null, !serial ? 'serial' : null]
                          .filter(Boolean)
                          .join(' y ');
                        statusLabel = 'Dato incompleto';
                        statusClass = 'bg-amber-100 text-amber-800';
                        cardClass = 'border-amber-200 bg-amber-50/40';
                        detailText = `El certificado quedó incompleto: falta ${missingParts}. ${
                          extraction?.reason ?? 'Revise legibilidad del documento.'
                        }`;
                      } else {
                        statusLabel = 'Referencia';
                        statusClass = 'bg-sky-100 text-sky-700';
                        cardClass = 'border-sky-200 bg-sky-50/40';
                        detailText = '';
                      }
                    } else if (doc.type === 'photo_plate') {
                      const current = normalizePlate(plate);
                      plateCurrentAvailable = Boolean(current);
                      plateReferenceAvailable = Boolean(referencePlate);
                      plateMatch =
                        plateCurrentAvailable && plateReferenceAvailable
                          ? areEquivalentWithOcrNoise(current, referencePlate)
                          : null;
                      if (!isDetected || !current) {
                        if (!isDetected) {
                          statusLabel = 'Tipo inválido';
                          statusClass = 'bg-rose-100 text-rose-700';
                          cardClass = 'border-rose-200 bg-rose-50/40';
                          detailText = extraction?.reason ?? 'No corresponde a una fotoplaca.';
                        } else {
                          statusLabel = 'Placa no detectada';
                          statusClass = 'bg-rose-100 text-rose-700';
                          cardClass = 'border-rose-200 bg-rose-50/40';
                          detailText = extraction?.reason ?? 'No fue posible detectar la placa en la imagen.';
                        }
                      } else if (!referencePlate) {
                        statusLabel = 'Sin referencia';
                        detailText = 'No hay placa de referencia en el certificado para comparar.';
                      } else if (areEquivalentWithOcrNoise(current, referencePlate)) {
                        statusLabel = 'Coincide';
                        statusClass = 'bg-emerald-100 text-emerald-700';
                        cardClass = 'border-emerald-200 bg-emerald-50/40';
                        detailText = 'La placa de la foto coincide con la placa del certificado.';
                      } else {
                        statusLabel = 'No coincide';
                        statusClass = 'bg-rose-100 text-rose-700';
                        cardClass = 'border-rose-200 bg-rose-50/40';
                        detailText = `Fotoplaca (${current}) no coincide con certificado (${referencePlate}).`;
                      }
                    } else if (doc.type === 'photo_serial') {
                      const current = normalizeSerial(serial);
                      serialCurrentAvailable = Boolean(current);
                      serialReferenceAvailable = Boolean(referenceSerial);
                      serialMatch =
                        serialCurrentAvailable && serialReferenceAvailable
                          ? areEquivalentWithOcrNoise(current, referenceSerial)
                          : null;
                      if (!isDetected || !current) {
                        if (!isDetected) {
                          statusLabel = 'Tipo inválido';
                          statusClass = 'bg-rose-100 text-rose-700';
                          cardClass = 'border-rose-200 bg-rose-50/40';
                          detailText = extraction?.reason ?? 'No corresponde a un fotoserial.';
                        } else {
                          statusLabel = 'Serial no detectado';
                          statusClass = 'bg-rose-100 text-rose-700';
                          cardClass = 'border-rose-200 bg-rose-50/40';
                          detailText = extraction?.reason ?? 'No fue posible detectar el serial en la imagen.';
                        }
                      } else if (!referenceSerial) {
                        statusLabel = 'Sin referencia';
                        detailText = 'No hay serial de referencia en el certificado para comparar.';
                      } else if (areEquivalentWithOcrNoise(current, referenceSerial)) {
                        statusLabel = 'Coincide';
                        statusClass = 'bg-emerald-100 text-emerald-700';
                        cardClass = 'border-emerald-200 bg-emerald-50/40';
                        detailText = 'El serial de la foto coincide con el serial del certificado.';
                      } else {
                        const likelyLowConfidenceRead = invoiceSerialMatchesReference && photoPlateMatchesReference;
                        statusLabel = likelyLowConfidenceRead ? 'No legible' : 'No coincide';
                        statusClass = likelyLowConfidenceRead ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-700';
                        cardClass = likelyLowConfidenceRead ? 'border-amber-200 bg-amber-50/40' : 'border-rose-200 bg-rose-50/40';
                        detailText = likelyLowConfidenceRead
                          ? 'No se pudo extraer el serial con suficiente confianza en la foto. Toma una imagen más frontal, sin reflejo y con mejor acercamiento.'
                          : `Fotoserial (${current}) no coincide con certificado (${referenceSerial}).`;
                      }
                    }

                    const plateValue =
                      doc.type === 'photo_serial' ? 'No aplica' : plate ? plate : isDetected ? 'No detectada' : 'Sin resultado';
                    const serialValue =
                      doc.type === 'photo_plate' ? 'No aplica' : serial ? serial : isDetected ? 'No detectado' : 'Sin resultado';
                    const showPlateRow = doc.type !== 'photo_serial';
                    const showSerialRow = doc.type !== 'photo_plate';
                    const getComparisonMeta = (match: boolean | null, hasCurrent: boolean, hasReference: boolean) => {
                      if (match === true) return { label: 'Coincide', className: 'text-emerald-700' };
                      if (match === false) return { label: 'No coincide', className: 'text-rose-700' };
                      if (!hasReference) return { label: 'Sin referencia', className: 'text-amber-700' };
                      if (!hasCurrent) return { label: 'Sin dato', className: 'text-slate-600' };
                      return { label: 'Sin datos suficientes', className: 'text-slate-600' };
                    };
                    const plateComparison = getComparisonMeta(plateMatch, plateCurrentAvailable, plateReferenceAvailable);
                    const serialComparison = getComparisonMeta(serialMatch, serialCurrentAvailable, serialReferenceAvailable);
                    const comparisonChipClass = (toneClass: string) => {
                      if (toneClass.includes('emerald')) return 'bg-emerald-100 text-emerald-700';
                      if (toneClass.includes('rose')) return 'bg-rose-100 text-rose-700';
                      if (toneClass.includes('amber')) return 'bg-amber-100 text-amber-800';
                      return 'bg-slate-100 text-slate-600';
                    };
                    const showInlineComparison = doc.type !== 'certificate_of_origin';

                    return (
                      <article key={doc.type} className={`rounded-xl border p-4 shadow-sm ${cardClass}`}>
                        <div className="flex items-start justify-between gap-3">
                          <h4 className="text-base font-semibold text-slate-800">{doc.label}</h4>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass}`}>{statusLabel}</span>
                        </div>

                        <div className="mt-4 space-y-2">
                          {showPlateRow ? (
                            <div className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Placa</span>
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-sm text-slate-800">{plateValue}</span>
                                {showInlineComparison ? (
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${comparisonChipClass(
                                      plateComparison.className
                                    )}`}
                                  >
                                    {plateComparison.label}
                                  </span>
                                ) : null}
                              </span>
                            </div>
                          ) : null}
                          {showSerialRow ? (
                            <div className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Serial</span>
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-sm text-slate-800">{serialValue}</span>
                                {showInlineComparison ? (
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${comparisonChipClass(
                                      serialComparison.className
                                    )}`}
                                  >
                                    {serialComparison.label}
                                  </span>
                                ) : null}
                              </span>
                            </div>
                          ) : null}
                        </div>

                        {detailText ? <p className="mt-3 text-xs text-slate-700">{detailText}</p> : null}
                      </article>
                    );
                  })}
                </div>
                {serialBlockedReason ? (
                  <p className="mt-3 text-sm font-medium text-rose-700">
                    Envío bloqueado: {serialBlockedReason}
                  </p>
                ) : null}
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={handleSendToDanaDemo}
                    disabled={!canSendToDana}
                    className={`btn-primary ${!canSendToDana ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    {sendingToDana ? 'Enviando...' : 'Enviar'}
                  </button>
                </div>
              </div>
            ) : null}

            {flowStep === 3 && Object.keys(rawExtractions).length > 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-display text-lg font-bold text-brand-secondary">Resumen General</h3>
                  </div>
                  <button
                    type="button"
                    onClick={handleStartNewExpedient}
                    disabled={!canResetRecord}
                    className={`btn-primary ${!canResetRecord ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    Nuevo expediente
                  </button>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Placa</p>
                    <p className="mt-2 text-sm text-slate-700">
                      Referencia (Certificado):{' '}
                      <span className="font-mono font-semibold text-slate-900">
                        {compareResult?.extracted_data?.certificate_plate ?? 'No encontrado'}
                      </span>
                    </p>
                    <p className="text-sm text-slate-700">
                      Factura:{' '}
                      <span className="font-mono font-semibold text-slate-900">
                        {compareResult?.extracted_data?.invoice_plate ?? 'No encontrado'}
                      </span>
                    </p>
                    <p className="text-sm text-slate-700">
                      Fotoplaca:{' '}
                      <span className="font-mono font-semibold text-slate-900">
                        {compareResult?.extracted_data?.photo_plate ?? 'No encontrado'}
                      </span>
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-800">
                      Coincidencia:{' '}
                      <span
                        className={
                          compareResult?.cross_validation?.plate_match
                            ? 'text-emerald-700'
                            : compareResult?.cross_validation?.plate_match === false
                              ? 'text-rose-700'
                              : 'text-amber-700'
                        }
                      >
                        {compareResult?.cross_validation?.plate_match
                          ? 'Sí'
                          : compareResult?.cross_validation?.plate_match === false
                            ? 'No'
                            : 'Sin datos suficientes'}
                      </span>
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Serial</p>
                    <p className="mt-2 text-sm text-slate-700">
                      Referencia (Certificado):{' '}
                      <span className="font-mono font-semibold text-slate-900">
                        {compareResult?.extracted_data?.certificate_serial ?? 'No encontrado'}
                      </span>
                    </p>
                    <p className="text-sm text-slate-700">
                      Factura:{' '}
                      <span className="font-mono font-semibold text-slate-900">
                        {compareResult?.extracted_data?.invoice_serial ?? 'No encontrado'}
                      </span>
                    </p>
                    <p className="text-sm text-slate-700">
                      Fotoserial:{' '}
                      <span className="font-mono font-semibold text-slate-900">
                        {compareResult?.extracted_data?.photo_serial ?? 'No encontrado'}
                      </span>
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-800">
                      Coincidencia:{' '}
                      <span
                        className={
                          compareResult?.cross_validation?.serial_match
                            ? 'text-emerald-700'
                            : compareResult?.cross_validation?.serial_match === false
                              ? 'text-rose-700'
                              : 'text-amber-700'
                        }
                      >
                        {compareResult?.cross_validation?.serial_match
                          ? 'Sí'
                          : compareResult?.cross_validation?.serial_match === false
                            ? 'No'
                            : 'Sin datos suficientes'}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resultado final del expediente</p>
                  <p className="mt-2 text-sm font-semibold text-slate-800">
                    Estado:{' '}
                    <span className={isSummaryValidated ? 'text-emerald-700' : 'text-amber-700'}>
                      {isSummaryValidated ? 'Documentos validados' : 'Revisión manual'}
                    </span>
                  </p>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

      </div>
    </section>
  );
};

export default ValidationPortalPage;
