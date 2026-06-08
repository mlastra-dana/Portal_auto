import { flowSteps } from '../../data/homeContent';

const HowItWorksSection = () => {
  return (
    <section id="como-funciona" className="container-app py-2 sm:py-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="section-title">Flujo de proceso</h2>
        <p className="section-subtitle">Secuencia operativa para validar expedientes de motocicletas.</p>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {flowSteps.map((step) => (
            <article key={step.title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-bold text-brand-secondary">{step.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{step.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
