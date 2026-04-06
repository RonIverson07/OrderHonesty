import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Self-Service Café & Honesty Store",
  description:
    "Order your favorite drinks and grab-and-go snacks.",
  icons: {
    icon: "/startuplabfavicon.jpg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen antialiased bg-[#f8f9fb]" suppressHydrationWarning>
        <Navbar />
        <main className="pt-24 pb-8 px-4 sm:px-6 max-w-7xl mx-auto">
          {children}
        </main>
      </body>
    </html>
  );
}
