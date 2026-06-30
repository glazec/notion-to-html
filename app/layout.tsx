import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Notion to HTML",
  description: "Publish Notion pages as generated HTML.",
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
