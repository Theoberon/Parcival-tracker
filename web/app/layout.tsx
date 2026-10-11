import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({ variable: "--font-plus-jakarta-sans", subsets: ["latin"] });
const ibmPlexMono = IBM_Plex_Mono({ variable: "--font-ibm-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Contest Scoreboard",
  description: "Private team contest",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plusJakartaSans.variable} ${ibmPlexMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <footer className="site-footer mx-auto flex w-full max-w-5xl flex-col items-center gap-3 px-4 py-5 text-center text-xs text-slate-500 sm:flex-row sm:justify-between">
          <span>© 2026 Oberon. All rights reserved.</span>
          <nav aria-label="Legal" className="flex items-center gap-4">
            <Link className="transition-colors hover:text-slate-800" href="/terms">Terms of Use</Link>
            <Link className="transition-colors hover:text-slate-800" href="/privacy">Privacy Policy</Link>
          </nav>
        </footer>
      </body>
    </html>
  );
}
