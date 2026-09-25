import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "DigitalizaTusNegocios AI OS", template: "%s · AI OS" },
  description: "Plataforma de agentes, workflows y conocimiento para empresas.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
