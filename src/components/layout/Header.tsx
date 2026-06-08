import { Link } from 'react-router-dom';
import exampleCompanyLogo from '../../brand/Marca_example/logos/svg/example_company_white.svg';

const Header = () => {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-brand-primary/95 text-white backdrop-blur">
      <div className="container-app flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center" aria-label="Ir al inicio">
          <img src={exampleCompanyLogo} alt="Example Company" className="h-10 w-auto sm:h-11" />
        </Link>
      </div>
    </header>
  );
};

export default Header;
