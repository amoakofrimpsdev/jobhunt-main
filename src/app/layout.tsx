import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
// Stands in for Clay's rounded display face, used at weight 500 only.
const display = Bricolage_Grotesque({ variable: "--font-display-face", subsets: ["latin"], weight: ["500"] });

export const metadata: Metadata = {
  title: "Jobhunt",
  description: "Jobs read straight from employers' boards, ranked for you, on your own computer.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Nav />
        {children}
      </body>
    </html>
  );
}
