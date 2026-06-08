interface LoadingStateProps {
  title?: string;
  description?: string;
}

const LoadingState = ({
  title = 'Validando expediente...',
  description = 'Estamos simulando verificaciones de tipo documental y consistencia de placa y serial.'
}: LoadingStateProps) => {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-soft">
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-primary border-t-transparent" />
        <div>
          <h3 className="font-display text-lg font-bold text-brand-secondary">{title}</h3>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
      </div>
    </div>
  );
};

export default LoadingState;
