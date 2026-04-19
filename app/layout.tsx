import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TIGER OS",
  description: "G'Day Tiger Café OS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://use.typekit.net" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://use.typekit.net" />
        <link rel="stylesheet" href="https://use.typekit.net/ssp5nld.css" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon-192.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Tiger OS" />
        <meta name="theme-color" content="#fbcdad" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
