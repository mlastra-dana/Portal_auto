import { ChangeEvent, useRef } from 'react';
import { DocumentType, UploadedDocument } from '../../types/validation';

interface UploadCardProps {
  document: UploadedDocument;
  onSelectFile: (type: UploadedDocument['type'], file: File) => void;
  onClear: (type: UploadedDocument['type']) => void;
  isValidating?: boolean;
  activityText?: string;
  helperText?: string;
}

const iconByDocument: Record<DocumentType, JSX.Element> = {
  invoice: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
      <path d="M10 13h6M10 17h6" />
    </svg>
  ),
  certificate_of_origin: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 4h14v16H5z" />
      <path d="M8 9h8M8 13h8" />
      <circle cx="9" cy="17" r="1.4" />
    </svg>
  ),
  photo_plate: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 12h10M7 9h2M15 15h2" />
    </svg>
  ),
  photo_serial: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h2M11 10h2M15 10h2M7 14h10" />
    </svg>
  )
};

const UploadCard = ({ document, onSelectFile, onClear, isValidating = false, activityText, helperText }: UploadCardProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isImageSlot = document.type === 'photo_plate' || document.type === 'photo_serial';
  const statusBadge = {
    pending: { label: 'Pendiente', className: 'bg-slate-100 text-slate-700' },
    uploaded: { label: 'Cargado', className: 'bg-brand-light text-brand-secondary' },
    validated: { label: isImageSlot ? 'Imagen válida' : 'Documento válido', className: 'bg-emerald-100 text-emerald-700' },
    error: { label: 'Error', className: 'bg-rose-100 text-rose-700' }
  }[document.status];

  const handleOpenFilePicker = () => {
    inputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onSelectFile(document.type, file);
    }
    event.target.value = '';
  };

  const handleClearFile = () => {
    if (inputRef.current) {
      inputRef.current.value = '';
    }
    onClear(document.type);
  };

  return (
    <article className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-soft sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-brand-light p-2 text-brand-secondary">{iconByDocument[document.type]}</div>
          <div>
            <h3 className="text-base font-bold text-brand-secondary">{document.label}</h3>
            <p className="mt-1 text-[11px] font-medium text-slate-500">Formato: {document.acceptedFormats}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {document.fileName ? (
            <button
              type="button"
              onClick={handleClearFile}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-sm font-bold text-slate-500 transition hover:border-rose-400 hover:text-rose-600"
              aria-label={`Quitar ${document.label}`}
            >
              ×
            </button>
          ) : null}
          {isValidating ? (
            <span
              className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-brand-secondary border-t-transparent"
              aria-label="Validando documento"
            />
          ) : null}
          <span className={`status-chip ${statusBadge.className}`}>{statusBadge.label}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleOpenFilePicker}
        className="mt-3 flex w-full items-center justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-left transition hover:border-brand-secondary hover:bg-brand-light/70"
      >
        <span className="text-sm font-medium text-slate-700">
          {document.fileName ? document.fileName : 'Seleccionar archivo'}
        </span>
        <span className="text-xs font-semibold text-brand-primary">Subir</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        onChange={handleFileChange}
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg"
      />

      {isValidating ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-brand-light">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-primary" />
        </div>
      ) : null}
      {document.errorMessage ? <p className="mt-2 text-xs font-medium text-rose-600">{document.errorMessage}</p> : null}
      {!document.errorMessage && activityText ? (
        <p className="mt-2 text-xs font-medium text-brand-primary">{activityText}</p>
      ) : null}
      {!document.errorMessage && !activityText && helperText ? (
        <p className="mt-2 text-xs font-medium text-slate-500">{helperText}</p>
      ) : null}
    </article>
  );
};

export default UploadCard;
