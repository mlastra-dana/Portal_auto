interface EmptyStateProps {
  title: string;
  description: string;
}

const EmptyState = ({ title, description }: EmptyStateProps) => {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-soft">
      <h3 className="font-display text-xl font-bold text-brand-secondary">{title}</h3>
      <p className="mx-auto mt-3 max-w-xl text-sm text-slate-600">{description}</p>
    </div>
  );
};

export default EmptyState;
