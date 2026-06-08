import { ValidationResult } from '../../types/validation';
import StatusBadge from '../ui/StatusBadge';

interface ValidationSummaryProps {
  result: ValidationResult;
}

const ValidationSummary = ({ result }: ValidationSummaryProps) => {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-brand-secondary">Resumen de validación</h3>
        </div>
        <StatusBadge status={result.overall_status} />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-semibold text-slate-800">Documentos</p>
          <p className="mt-2">Factura: {result.invoice_document_valid ? 'Correcta' : 'Inconsistente'}</p>
          <p>Certificado de origen: {result.certificate_document_valid ? 'Correcto' : 'Inconsistente'}</p>
          <p>Fotoplaca: {result.photo_plate_valid ? 'Correcta' : 'Inconsistente'}</p>
          <p>Fotoserial: {result.photo_serial_valid ? 'Correcta' : 'Inconsistente'}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-semibold text-slate-800">Coincidencias</p>
          <p className="mt-2">Placa: {result.plate_match ? 'Coincide' : 'Observada'}</p>
          <p>Serial: {result.serial_match ? 'Coincide' : 'Observado'}</p>
        </div>
      </div>
    </div>
  );
};

export default ValidationSummary;
