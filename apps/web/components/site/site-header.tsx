import Link from "next/link";
import { Container } from "./ui";

const NAV = [
  ["/soluciones", "Soluciones"],
  ["/sectores", "Sectores"],
  ["/casos-de-uso", "Casos de uso"],
  ["/precios", "Precios"],
  ["/demo", "Demo"],
] as const;

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold text-white" aria-label="DigitalizaTusNegocios, inicio">
      <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-cyan-400 text-sm font-bold text-white shadow-lg shadow-violet-900/40">
        D
      </span>
      <span className="leading-tight">
        DigitalizaTusNegocios<span className="block text-[10px] font-medium uppercase tracking-[0.25em] text-cyan-300/80">AI OS</span>
      </span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#070A14]/80 backdrop-blur-xl">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm text-slate-300 lg:flex" aria-label="Principal">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="transition hover:text-white">
              {label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <Link href="/login" className="text-sm text-slate-300 hover:text-white">
            Acceder
          </Link>
          <Link href="/contacto" className="inline-flex h-9 items-center rounded-full bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-200">
            Hablar con nosotros
          </Link>
        </div>
        <details className="group relative lg:hidden">
          <summary className="flex h-10 cursor-pointer list-none items-center rounded-full border border-white/15 px-4 text-sm text-white [&::-webkit-details-marker]:hidden" aria-label="Abrir menú">
            Menú
          </summary>
          <nav className="absolute right-0 mt-2 w-60 rounded-2xl border border-white/10 bg-[#0B1020] p-2 shadow-2xl" aria-label="Menú móvil">
            {[...NAV, ["/contacto", "Contacto"] as const, ["/login", "Acceder"] as const].map(([href, label]) => (
              <Link key={href} href={href} className="block rounded-xl px-4 py-3 text-sm text-slate-200 hover:bg-white/5">
                {label}
              </Link>
            ))}
          </nav>
        </details>
      </Container>
    </header>
  );
}
