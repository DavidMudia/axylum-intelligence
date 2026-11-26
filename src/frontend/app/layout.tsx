import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { AppShell } from "@/components/navigation/AppShell";

export const metadata: Metadata = {
  title: "Axylum Intelligence",
  applicationName: "Axylum Intelligence",
  description: "An intelligent market research and algorithmic trading environment.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Axylum",
  },
  icons: {
    icon: [
      { url: "/icons/axylum-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/axylum-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/axylum-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#07090d",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
