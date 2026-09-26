import Link from "next/link";
import { SITE_SOLUTIONS } from "@/lib/site-content";
import { Logo } from "./site-header";
import { Container } from "./ui";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/5 py-12 text-sm text-slate-400">
      <Container className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <Logo />
          <p>Agencia de soluciones de IA para empresas: configuramos, desplegamos y gestionamos agentes y automatizaciones.</p>
        </div>
        <div>
          <p className="mb-3 font-semibold text-slate-200">Soluciones</p>
          <ul className="space-y-2">
            {SITE_SOLUTIONS.map((s) => (
              <li key={s.slug}>
                <Link href={`/soluciones/${s.slug}`} className="hover:text-white">
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-3 font-semibold text-slate-200">Empresa</p>
          <ul className="space-y-2">
            {(
              [
                ["/sectores", "Sectores"],
                ["/casos-de-uso", "Casos de uso"],
                ["/precios", "Precios"],
                ["/demo", "Demo"],
                ["/contacto", "Contacto"],
              ] as const
            ).map(([h, l]) => (
              <li key={h}>
                <Link href={h} className="hover:text-white">
                  {l}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-3 font-semibold text-slate-200">Legal</p>
          <ul className="space-y-2">
            <li>
              <Link href="/privacidad" className="hover:text-white">
                Política de privacidad
              </Link>
            </li>
            <li>
              <Link href="/aviso-legal" className="hover:text-white">
                Aviso legal
              </Link>
            </li>
            <li>
              <Link href="/login" className="hover:text-white">
                Acceso clientes
              </Link>
            </li>
          </ul>
        </div>
      </Container>
      <Container className="mt-10 border-t border-white/5 pt-6 text-xs">© {new Date().getFullYear()} DigitalizaTusNegocios</Container>
    </footer>
  );
}
