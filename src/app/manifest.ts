import type { MetadataRoute } from "next";
import { BRAND_NAME } from "@/lib/brand";

// Makes the site installable as an app on phones and computers ("Add to home
// screen"). It opens on the server list; signed out, that leads to the login.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: "Serwery Minecraft i Terraria: zarządzaj nimi z telefonu.",
    lang: "pl",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0f14",
    theme_color: "#0b0f14",
    categories: ["games", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Nowy serwer", url: "/dashboard/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Pomoc", url: "/dashboard/support", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
