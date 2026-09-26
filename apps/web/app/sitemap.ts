import type { MetadataRoute } from "next";
import { SITE_SOLUTIONS } from "@/lib/site-content";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const paths = ["/", "/soluciones", ...SITE_SOLUTIONS.map((s) => `/soluciones/${s.slug}`), "/sectores", "/casos-de-uso", "/precios", "/demo", "/contacto", "/privacidad", "/aviso-legal"];
  return paths.map((p) => ({ url: `${base}${p}` }));
}
