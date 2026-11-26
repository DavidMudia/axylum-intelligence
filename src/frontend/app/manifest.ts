import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Axylum Intelligence",
    short_name: "Axylum",
    description: "Market intelligence and trading terminal.",
    start_url: "/",
    display: "standalone",
    background_color: "#07090d",
    theme_color: "#07090d",
    icons: [
      { src: "/icons/axylum-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/axylum-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/axylum-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
