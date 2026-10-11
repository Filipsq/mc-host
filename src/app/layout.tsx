import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MC Host",
  description: "Free and paid Minecraft server hosting for Java and Bedrock",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
