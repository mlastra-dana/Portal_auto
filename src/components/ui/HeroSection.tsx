import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import exampleCompanyLogoColor from '../../brand/Marca_example/logos/svg/example_company_color.svg';

const normalizeId = (value: string) => value.replace(/\s+/g, '').toUpperCase();
const isValidIdentity = (value: string) => /^(V|E|J|G)?-?\d{6,10}$/.test(normalizeId(value));

const HeroSection = () => {
  const navigate = useNavigate();
  const [identity, setIdentity] = useState('');
  const [touched, setTouched] = useState(false);
  const identityIsValid = isValidIdentity(identity);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (!identityIsValid) return;
    sessionStorage.setItem('autoPortalIdentity', normalizeId(identity));
    navigate('/validation');
  };

  return (
    <section className="container-app flex min-h-[calc(100vh-8rem)] items-center justify-center py-8 sm:py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
        <img src={exampleCompanyLogoColor} alt="Example Company" className="h-14 w-auto" />

        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-secondary">Auto Portal</p>
          <h1 className="mt-2 font-display text-2xl font-bold text-brand-primary">Ingresa con tu cedula</h1>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <label className="block space-y-1 text-sm font-semibold text-slate-700">
            <span>Cedula o RIF</span>
            <input
              type="text"
              value={identity}
              onBlur={() => setTouched(true)}
              onChange={(event) => setIdentity(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm uppercase text-slate-900 outline-none transition focus:border-brand-secondary"
              placeholder="Ej. V12345678"
              autoComplete="username"
              autoFocus
            />
          </label>

          {touched && !identityIsValid ? (
            <p className="text-sm font-medium text-rose-700">Ingresa una cedula o RIF valido.</p>
          ) : null}

          <button
            type="submit"
            disabled={!identityIsValid}
            className={`btn-primary w-full py-3 ${!identityIsValid ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            Ingresar
          </button>
        </form>
      </div>
    </section>
  );
};

export default HeroSection;
