import { benefits } from '../../data/homeContent';

const BenefitsSection = () => {
  return (
    <section className="container-app py-8 sm:py-10">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="section-title">Alcance de la validación</h2>
        <p className="section-subtitle">
          El portal verifica la tipología documental y la consistencia del expediente para la operación interna o aliados.
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {benefits.map((benefit) => (
            <article key={benefit.title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-bold text-brand-secondary">{benefit.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{benefit.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default BenefitsSection;
