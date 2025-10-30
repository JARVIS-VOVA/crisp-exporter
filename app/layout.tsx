import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Crisp Exporter - Export Conversations & Messages to Excel",
  description: "Crisp Exporter is a web app that allows you to fetch Crisp conversations and messages and export them to Excel",
  keywords: [
    "crisp Exporter",
    "crisp API",
    "crisp export messages",
    "crisp export conversations",
  ],
  openGraph: {
    title: "Crisp Exporter - Export Conversations & Messages to Excel",
    description: "Web app to fetch Crisp conversations and messages and export them to Excel.",
    url: "https://crisp-exporter.vercel.app",
    siteName: "Crisp Exporter",
    locale: "en_US",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Toaster position="top-center" richColors />
        {children}
      </body>
    </html>
  );
}
