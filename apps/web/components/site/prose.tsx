import type { ReactNode } from "react";

export function Prose({ children }: { children: ReactNode }) {
  return <div className="max-w-3xl space-y-4 text-slate-300 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-white [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-white">{children}</div>;
}
