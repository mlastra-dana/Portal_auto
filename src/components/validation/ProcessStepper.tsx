interface ProcessStepperProps {
  currentStep: 1 | 2;
}

const steps = [
  { id: 1, label: 'Agente' },
  { id: 2, label: 'Validación' }
] as const;

const ProcessStepper = ({ currentStep }: ProcessStepperProps) => {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-soft sm:p-4">
      <ol className="grid gap-2 md:grid-cols-3">
        {steps.map((step) => {
          const isCompleted = currentStep > step.id;
          const isActive = currentStep === step.id;

          return (
            <li key={step.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                  isCompleted
                    ? 'bg-emerald-100 text-emerald-700'
                    : isActive
                      ? 'bg-brand-light text-brand-secondary'
                      : 'bg-slate-200 text-slate-600'
                }`}
              >
                {step.id}
              </span>
              <p className="text-sm font-semibold text-slate-800">{step.label}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default ProcessStepper;
