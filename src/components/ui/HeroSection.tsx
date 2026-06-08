import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import exampleCompanyLogoColor from '../../brand/Marca_example/logos/svg/example_company_color.svg';

const normalizeId = (prefix: string, value: string) => `${prefix}${value.replace(/\D/g, '')}`.toUpperCase();
const isValidIdentity = (value: string) => /^\d{6,10}$/.test(value.replace(/\D/g, ''));

const HeroSection = () => {
  const navigate = useNavigate();
  const [identityPrefix, setIdentityPrefix] = useState('V');
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const identityIsValid = isValidIdentity(identity);
  const canSubmit = identityIsValid && password.trim().length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    sessionStorage.setItem('autoPortalIdentity', normalizeId(identityPrefix, identity));
    navigate('/validation');
  };

  return (
    <section className="container-app flex min-h-[calc(100vh-8rem)] items-center justify-center py-8 sm:py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
        <img src={exampleCompanyLogoColor} alt="Example Company" className="h-14 w-auto" />

        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-secondary">Auto Portal</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <label className="block space-y-1 text-sm font-semibold text-slate-700">
            <span>Cedula o RIF</span>
            <div className="flex overflow-hidden rounded-xl border border-slate-300 bg-white transition focus-within:border-brand-secondary">
              <select
                value={identityPrefix}
                onChange={(event) => setIdentityPrefix(event.target.value)}
                className="border-r border-slate-300 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-800 outline-none"
                aria-label="Tipo de documento"
              >
                <option value="V">V</option>
                <option value="E">E</option>
                <option value="J">J</option>
                <option value="G">G</option>
              </select>
              <input
                type="text"
                value={identity}
                onBlur={() => setTouched(true)}
                onChange={(event) => setIdentity(event.target.value.replace(/\D/g, ''))}
                className="min-w-0 flex-1 px-3 py-3 text-sm text-slate-900 outline-none"
                placeholder="12345678"
                autoComplete="username"
                inputMode="numeric"
                autoFocus
              />
            </div>
          </label>

          <label className="block space-y-1 text-sm font-semibold text-slate-700">
            <span>Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-brand-secondary"
              placeholder="Contraseña demo"
              autoComplete="current-password"
            />
          </label>

          {touched && !identityIsValid ? (
            <p className="text-sm font-medium text-rose-700">Ingresa un numero de cedula o RIF valido.</p>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className={`btn-primary w-full py-3 ${!canSubmit ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            Ingresar
          </button>
        </form>
      </div>
    </section>
  );
};

export default HeroSection;
