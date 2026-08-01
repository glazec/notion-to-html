import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Notion to HTML",
  description: "Turn public Notion pages into carefully typeset websites.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
