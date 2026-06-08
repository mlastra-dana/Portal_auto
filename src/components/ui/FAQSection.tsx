import { faqs } from '../../data/homeContent';

const FAQSection = () => {
  return (
    <section id="ayuda" className="container-app py-8 sm:py-10">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="section-title">Ayuda operativa</h2>
        <div className="mt-6 space-y-3">
          {faqs.map((faq) => (
            <details key={faq.question} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer list-none text-sm font-semibold text-brand-secondary">
                {faq.question}
              </summary>
              <p className="mt-2 text-sm text-slate-600">{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FAQSection;
