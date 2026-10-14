import type { Edition } from "@prisma/client";

const ICONS: Record<Edition, { src: string; alt: string }> = {
  JAVA: { src: "/art/block-grass.svg", alt: "Java" },
  BEDROCK: { src: "/art/block-stone.svg", alt: "Bedrock" },
  TERRARIA: { src: "/art/sword.svg", alt: "Terraria" },
};

/** A grass block for Java, a dark stone block for Bedrock and a pixel sword for Terraria. */
export default function EditionIcon({ edition, size = 36 }: { edition: Edition; size?: number }) {
  const icon = ICONS[edition];
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={icon.src} alt={icon.alt} width={size} height={size} />;
}
