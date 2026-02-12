import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ToastContainer from "@/app/components/Toast";
import TourOverlay from "@/app/components/Tour";
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
  title: "DMX Adapter Explorer & Simulator",
  description:
    "Probe your SoundSwitch DMX adapter and simulate laser control in real time",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <ToastContainer />
        <TourOverlay />
      </body>
    </html>
  );
}
