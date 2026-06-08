import { Link } from 'react-router-dom';
import exampleCompanyLogoColor from '../../brand/Marca_example/logos/svg/example_company_color.svg';

const HeroSection = () => {
  return (
    <section className="container-app py-6 sm:py-8">
      <div className="overflow-hidden rounded-2xl border border-white/15 bg-brand-primary shadow-card">
        <div className="grid min-h-[430px] lg:grid-cols-[1fr,420px]">
          <div className="bg-hero-mesh px-6 py-10 sm:px-10 sm:py-12">
            <div className="max-w-3xl">
              <div className="mb-6 flex items-center gap-3">
                <span className="h-px w-12 bg-brand-accent" />
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-light">
                  Sistema operativo documental
                </p>
              </div>
              <h1 className="font-display text-3xl font-bold leading-tight text-white sm:text-5xl">
                Verificación logística con criterio operativo
              </h1>
              <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
                Example Company centraliza soportes, evidencias y coincidencias críticas para decidir si un expediente avanza, se observa
                o requiere revisión manual.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link to="/validation" className="btn-primary">
                  Abrir expediente
                </Link>
                <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Factura · Certificado · Fotos</span>
              </div>
            </div>
          </div>

          <div className="bg-brand-light p-5 sm:p-6">
            <div className="h-full rounded-xl border border-slate-200 bg-white p-4 shadow-soft">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expediente</p>
                  <p className="mt-1 font-mono text-sm font-semibold text-brand-primary">EXP-EX-0417</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Listo</span>
              </div>

              <div className="mt-4 rounded-xl border border-brand-light bg-white px-3 py-2">
                <img src={exampleCompanyLogoColor} alt="Example Company" className="h-12 w-auto" />
              </div>

              <div className="mt-4 space-y-3">
                {['Certificado de origen', 'Factura', 'Fotoplaca', 'Fotoserial'].map((item, index) => (
                  <div key={item} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-secondary text-xs font-bold text-white">
                        {index + 1}
                      </span>
                      <span className="text-sm font-semibold text-slate-700">{item}</span>
                    </div>
                    <span className="h-2 w-12 rounded-full bg-brand-lilac" />
                  </div>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-brand-primary p-4 text-white">
                  <p className="text-xs font-semibold uppercase tracking-wide text-white/50">Placa</p>
                  <p className="mt-2 font-mono text-lg font-bold">AB124CD</p>
                </div>
                <div className="rounded-xl bg-brand-accent p-4 text-white">
                  <p className="text-xs font-semibold uppercase tracking-wide text-white/70">Serial</p>
                  <p className="mt-2 font-mono text-lg font-bold">93K7A21</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
