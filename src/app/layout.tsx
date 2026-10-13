import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "cli console — your tools, one workspace", description: "Generate a local command workspace from the tools already installed on your machine." };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
