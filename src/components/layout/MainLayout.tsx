import { PropsWithChildren } from 'react';
import Footer from './Footer';
import Header from './Header';

const MainLayout = ({ children }: PropsWithChildren) => {
  return (
    <div className="flex min-h-screen flex-col bg-brand-primary">
      <Header />
      <main className="flex-1 bg-[linear-gradient(180deg,#0F0F1F_0%,#241064_52%,#F3EDFF_52%,#F3EDFF_100%)]">
        {children}
      </main>
      <Footer />
    </div>
  );
};

export default MainLayout;
