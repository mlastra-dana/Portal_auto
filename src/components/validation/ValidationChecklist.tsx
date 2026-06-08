import { ValidationChecklistItem } from '../../types/validation';

interface ValidationChecklistProps {
  items: ValidationChecklistItem[];
}

const ValidationChecklist = ({ items }: ValidationChecklistProps) => {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
      <h3 className="font-display text-lg font-bold text-brand-secondary">Checklist</h3>
      <ul className="mt-3 space-y-2.5">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
            <span className="text-sm font-medium text-slate-700">{item.label}</span>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                item.valid ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
              }`}
            >
              {item.valid ? 'OK' : 'Falla'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ValidationChecklist;
