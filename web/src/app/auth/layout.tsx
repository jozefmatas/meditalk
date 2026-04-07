import type { Viewport } from "next";
import { Figtree } from "next/font/google";
import "../globals.css";

const figtree = Figtree({
  subsets: ["latin", "latin-ext"],
});

export const viewport: Viewport = {
  themeColor: "#4945ff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${figtree.className} antialiased`}>{children}</body>
    </html>
  );
}
