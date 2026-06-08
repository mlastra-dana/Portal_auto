const Footer = () => {
  return (
    <footer className="border-t border-slate-200 bg-brand-light">
      <div className="container-app py-4 text-center text-xs font-medium text-slate-500">
        © {new Date().getFullYear()} Example Company | Verificación logística documental
      </div>
    </footer>
  );
};

export default Footer;
