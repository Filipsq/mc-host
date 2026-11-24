import type { Metadata } from "next";
import Link from "next/link";
import { guides } from "@/lib/guides";

export const metadata: Metadata = {
  title: "Poradniki: serwer Minecraft krok po kroku",
  description:
    "Poradniki o serwerach Minecraft: jak założyć darmowy serwer, ile RAM wybrać i jak zrobić serwer z modami na Fabricu, Forge i NeoForge.",
  alternates: { canonical: "/poradniki" },
};

export default function GuidesPage() {
  return (
    <main className="legal guide" lang="pl">
      <h1>Poradniki o serwerach Minecraft</h1>
      <p className="lead">Krótko i po polsku: jak założyć serwer, ile RAM-u wybrać i jak grać ze znajomymi na modach.</p>
      <div className="guide-list">
        {guides().map((g) => (
          <Link key={g.slug} href={`/poradniki/${g.slug}`} className="card guide-card">
            <h2>{g.h1}</h2>
            <p className="muted">{g.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
