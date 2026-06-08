import { ValidationResult } from '../../types/validation';
import ValidationSummary from './ValidationSummary';

interface ResultPanelProps {
  result: ValidationResult;
  onReset: () => void;
}

const ResultPanel = ({ result, onReset }: ResultPanelProps) => {
  const isValidated = result.overall_status === 'validated';

  return (
    <section className="space-y-4">
      <ValidationSummary result={result} />

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
        <p className="text-sm font-medium text-slate-700">
          {isValidated
            ? 'Expediente validado y consistente.'
            : 'Expediente observado: los datos de fotos no coinciden con los documentos de referencia.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={onReset}>
            Validar otro expediente
          </button>
        </div>
      </div>
    </section>
  );
};

export default ResultPanel;
