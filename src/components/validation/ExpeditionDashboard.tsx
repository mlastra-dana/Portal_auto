import { UploadedDocument, ValidationResult } from '../../types/validation';
import StatusBadge from '../ui/StatusBadge';

interface ExpeditionDashboardProps {
  documents: UploadedDocument[];
  result: ValidationResult | null;
  isValidating: boolean;
}

const ExpeditionDashboard = ({ documents, result, isValidating }: ExpeditionDashboardProps) => {
  const uploaded = documents.filter((doc) => doc.file).length;

  return (
    <aside className="space-y-4 lg:sticky lg:top-24">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
        <h2 className="font-display text-lg font-bold text-brand-secondary">Resumen del expediente</h2>
        <p className="mt-1 text-xs text-slate-500">Control operativo en tiempo real</p>

        <div className="mt-4 space-y-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Documentos cargados</p>
            <p className="mt-1 text-lg font-bold text-slate-800">{uploaded}/4</p>
          </div>

          {documents.map((document) => (
            <div key={document.type} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
              <p className="text-sm font-medium text-slate-700">{document.label}</p>
              <StatusBadge status={document.status} />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
        <h3 className="font-display text-base font-bold text-brand-secondary">Estado de validación</h3>
        {isValidating ? (
          <p className="mt-3 text-sm text-slate-600">Ejecutando validaciones del expediente...</p>
        ) : null}

        {!isValidating && !result ? (
          <p className="mt-3 text-sm text-slate-600">
            Cargue los documentos requeridos y ejecute la validación para obtener un resultado.
          </p>
        ) : null}

        {!isValidating && result ? (
          <div className="mt-3 space-y-3 text-sm text-slate-700">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
              <span>Estado final</span>
              <StatusBadge status={result.overall_status} />
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
              <span>Coincidencia de placa</span>
              <span className={result.plate_match ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                {result.plate_match ? 'Coincide' : 'Observado'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
              <span>Coincidencia de serial</span>
              <span className={result.serial_match ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                {result.serial_match ? 'Coincide' : 'Observado'}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
};

export default ExpeditionDashboard;
