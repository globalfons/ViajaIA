import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: ["/", "/soluciones", "/sectores", "/precios", "/casos-de-uso", "/demo", "/contacto", "/privacidad", "/aviso-legal"], disallow: ["/api/", "/chat/", "/dashboard", "/admin", "/login"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
