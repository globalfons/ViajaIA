import Link from "next/link";
import type { ReactNode } from "react";

/** Public website primitives (own visual identity: ink background, violet→cyan accents). */

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

export function Section({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`py-16 sm:py-24 ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/90">{children}</p>;
}

export function Gradient({ children }: { children: ReactNode }) {
  return <span className="bg-gradient-to-r from-violet-300 via-fuchsia-200 to-cyan-200 bg-clip-text text-transparent">{children}</span>;
}

export function H1({ children }: { children: ReactNode }) {
  return <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">{children}</h1>;
}

export function H2({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`text-3xl font-semibold tracking-tight text-white sm:text-4xl ${className}`}>{children}</h2>;
}

export function Lead({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-lg leading-relaxed text-slate-300 ${className}`}>{children}</p>;
}

export function ButtonLink({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "ghost" }) {
  const base = "inline-flex h-11 items-center justify-center rounded-full px-6 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300";
  return (
    <Link
      href={href}
      className={
        variant === "primary"
          ? `${base} bg-gradient-to-r from-violet-500 to-cyan-500 text-white shadow-lg shadow-violet-900/40 hover:brightness-110`
          : `${base} border border-white/15 bg-white/5 text-white hover:bg-white/10`
      }
    >
      {children}
    </Link>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur ${className}`}>{children}</div>;
}

export function Check({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3 text-slate-300">
      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gradient-to-r from-violet-400 to-cyan-300" />
      <span>{children}</span>
    </li>
  );
}

export function PageHero({ eyebrow, title, intro, children }: { eyebrow: string; title: ReactNode; intro: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b border-white/5 pb-14 pt-16 sm:pb-20 sm:pt-24">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[900px] max-w-none -translate-x-1/2 rounded-full bg-gradient-to-r from-violet-700/30 via-fuchsia-600/10 to-cyan-600/25 blur-3xl" />
      <Container className="relative">
        <Eyebrow>{eyebrow}</Eyebrow>
        <div className="max-w-3xl space-y-5">
          <H1>{title}</H1>
          <Lead>{intro}</Lead>
          {children}
        </div>
      </Container>
    </section>
  );
}

export function CtaBand() {
  return (
    <Section>
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-violet-950 via-[#0B1020] to-cyan-950 p-8 sm:p-12">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="relative max-w-2xl space-y-4">
          <H2>¿Qué parte de tu negocio quieres automatizar primero?</H2>
          <Lead>Cuéntanos tu caso. Te proponemos una solución concreta, qué necesitamos de ti y cómo la medimos.</Lead>
          <div className="flex flex-wrap gap-3 pt-2">
            <ButtonLink href="/contacto">Solicitar propuesta</ButtonLink>
            <ButtonLink href="/demo" variant="ghost">
              Probar la demo
            </ButtonLink>
          </div>
        </div>
      </div>
    </Section>
  );
}
