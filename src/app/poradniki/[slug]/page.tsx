import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import GuideText, { Inline, plainText } from "@/components/GuideText";
import JsonLd from "@/components/JsonLd";
import { BRAND_NAME } from "@/lib/brand";
import { guideBySlug, guides } from "@/lib/guides";
import { siteUrl } from "@/lib/site";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return guides().map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = guideBySlug((await params).slug);
  if (!guide) return {};
  const url = `/poradniki/${guide.slug}`;
  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical: url },
    openGraph: { type: "article", title: guide.title, description: guide.description, url, locale: "pl_PL" },
  };
}

export default async function GuidePage({ params }: Props) {
  const guide = guideBySlug((await params).slug);
  if (!guide) notFound();
  const base = siteUrl();
  const url = `${base}/poradniki/${guide.slug}`;
  const others = guides().filter((g) => g.slug !== guide.slug);
  const date = new Intl.DateTimeFormat("pl-PL", { dateStyle: "long" }).format(new Date(guide.updated));
  return (
    <main className="legal guide" lang="pl">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Article",
              headline: guide.h1,
              description: guide.description,
              inLanguage: "pl-PL",
              datePublished: guide.updated,
              dateModified: guide.updated,
              mainEntityOfPage: url,
              author: { "@type": "Organization", name: BRAND_NAME, url: base },
              publisher: { "@type": "Organization", name: BRAND_NAME, url: base },
            },
            ...(guide.video
              ? [
                  {
                    "@type": "VideoObject",
                    name: guide.video.name,
                    description: guide.description,
                    thumbnailUrl: `${base}${guide.video.poster}`,
                    contentUrl: `${base}${guide.video.src}`,
                    uploadDate: guide.video.uploaded,
                    duration: `PT${guide.video.seconds}S`,
                    inLanguage: "pl-PL",
                  },
                ]
              : []),
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: BRAND_NAME, item: base },
                { "@type": "ListItem", position: 2, name: "Poradniki", item: `${base}/poradniki` },
                { "@type": "ListItem", position: 3, name: guide.h1, item: url },
              ],
            },
            {
              "@type": "FAQPage",
              mainEntity: guide.faq.map((f) => ({
                "@type": "Question",
                name: f.q,
                acceptedAnswer: { "@type": "Answer", text: plainText(f.a) },
              })),
            },
          ],
        }}
      />
      <nav className="guide-crumbs muted small" aria-label="Ścieżka">
        <Link href="/">{BRAND_NAME}</Link> / <Link href="/poradniki">Poradniki</Link>
      </nav>
      <h1>{guide.h1}</h1>
      <p className="muted small">Aktualizacja: {date}</p>
      <p className="lead">{guide.intro}</p>
      {guide.video && (
        <figure className="guide-video">
          <video controls playsInline preload="none" poster={guide.video.poster} width={720} height={1280}>
            <source src={guide.video.src} type="video/mp4" />
          </video>
          <figcaption className="muted small">{guide.video.name}</figcaption>
        </figure>
      )}
      {guide.sections.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          <GuideText lines={s.body} />
        </section>
      ))}
      <section>
        <h2>Najczęstsze pytania</h2>
        <div className="faq">
          {guide.faq.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p className="muted"><Inline text={f.a} /></p>
            </details>
          ))}
        </div>
      </section>
      <div className="cta-band guide-cta">
        <div>
          <h2>Załóż darmowy serwer Minecraft</h2>
          <p>Java i Bedrock z crossplay, bez karty i bez limitu czasu.</p>
        </div>
        <Link className="button large light" href="/signup">Załóż serwer</Link>
      </div>
      <section>
        <h2>Inne poradniki</h2>
        <ul>
          {others.map((g) => (
            <li key={g.slug}><Link href={`/poradniki/${g.slug}`}>{g.h1}</Link></li>
          ))}
        </ul>
      </section>
    </main>
  );
}
