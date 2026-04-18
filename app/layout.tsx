import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "G'Day Tiger OS",
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
        <link rel="stylesheet" href="https://use.typekit.net/ssp5nld.css" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
