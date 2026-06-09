import { Link, useNavigate } from 'react-router-dom';
import exampleInsuranceLogo from '../../brand/Marca_example/logos/svg/example_insurance_white.svg';

const Header = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    sessionStorage.removeItem('autoPortalIdentity');
    navigate('/', { replace: true });
    window.dispatchEvent(new Event('autoPortalLogout'));
  };

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-brand-primary/95 text-white backdrop-blur">
      <div className="container-app flex h-20 items-center justify-between">
        <Link to="/" className="flex items-center" aria-label="Ir al inicio">
          <img src={exampleInsuranceLogo} alt="Example Insurance" className="h-14 w-auto sm:h-16" />
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex items-center justify-center rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          Salir
        </button>
      </div>
    </header>
  );
};

export default Header;
