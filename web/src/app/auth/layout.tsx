import type { Viewport } from "next";
import { Figtree } from "next/font/google";
import "../globals.css";

const figtree = Figtree({
  subsets: ["latin", "latin-ext"],
});

export const viewport: Viewport = {
  themeColor: "#f1eee7",
  width: "device-width",
  initialScale: 1,
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
