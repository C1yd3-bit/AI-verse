import type { Metadata } from "next";
import "@fontsource-variable/dm-sans";
import "@fontsource/cormorant-garamond/400.css";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { AppearanceProvider } from "@/components/appearance-provider";
import { appearanceBootScript } from "@/lib/appearance";

export const metadata: Metadata = {
  title: { default: "AIVerse — Find your next world", template: "%s · AIVerse" },
  description:
    "Discover AI-created reels and short films. Explore content inspiration, genre and format with Fusion.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceBootScript }} />
      </head>
      <body>
        <AppearanceProvider>
          <AppShell>{children}</AppShell>
        </AppearanceProvider>
      </body>
    </html>
  );
}
