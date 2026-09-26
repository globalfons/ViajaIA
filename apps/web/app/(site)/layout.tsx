import type { Metadata } from "next";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

export const metadata: Metadata = {
  title: { default: "DigitalizaTusNegocios · Soluciones de IA para empresas", template: "%s · DigitalizaTusNegocios" },
  description: "Agentes de IA para atención al cliente, ventas, WhatsApp, documentos y automatización. Configurados con tus datos, con control humano y costes a la vista.",
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#070A14] text-slate-100 selection:bg-violet-500/40" data-theme="dark">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-slate-900">
        Saltar al contenido
      </a>
      <SiteHeader />
      <main id="contenido">{children}</main>
      <SiteFooter />
    </div>
  );
}
