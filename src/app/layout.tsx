import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Tally: cash now, repaid first", template: "%s · Tally" },
  description:
    "Tally advances stablecoin to AI agents against the payments they are already owed through HSP reusable mandates, and repays the pool automatically on-chain.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
