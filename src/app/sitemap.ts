import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { guides } from "@/lib/guides";

export const dynamic = "force-dynamic";

const PAGES = ["", "/poradniki", "/signup", "/porownanie", "/prezent", "/aplikacja", "/kontakt", "/regulamin", "/polityka-prywatnosci"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    ...PAGES.map((path) => ({
      url: `${base}${path}`,
      changeFrequency: path === "" ? ("weekly" as const) : ("monthly" as const),
      priority: path === "" ? 1 : 0.5,
    })),
    ...guides().map((g) => ({
      url: `${base}/poradniki/${g.slug}`,
      lastModified: g.updated,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
