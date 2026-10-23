import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ShellGate } from "@/components/shell/ShellGate";
import { AuthProvider } from "@/lib/auth";
import { SITE } from "@/lib/site";
import { theme, themeToCss } from "@/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: SITE.name, template: `%s · ${SITE.name}` },
  description: SITE.description,
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <style id="theme-tokens" dangerouslySetInnerHTML={{ __html: themeToCss(theme) }} />
      </head>
      <body>
        <AuthProvider>
          <ShellGate>{children}</ShellGate>
        </AuthProvider>
      </body>
    </html>
  );
}
