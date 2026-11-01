import type { Edition } from "@prisma/client";

const ICONS: Record<Edition, { src: string; alt: string }> = {
  JAVA: { src: "/art/block-grass.svg", alt: "Java" },
  BEDROCK: { src: "/art/block-stone.svg", alt: "Bedrock" },
  TERRARIA: { src: "/art/sword.svg", alt: "Terraria" },
  VALHEIM: { src: "/art/axe.svg", alt: "Valheim" },
  HYTALE: { src: "/art/crystal.svg", alt: "Hytale" },
};

/** A grass block for Java, a dark stone block for Bedrock, a pixel sword for Terraria, an axe for Valheim and a crystal for Hytale. */
export default function EditionIcon({ edition, size = 36 }: { edition: Edition; size?: number }) {
  const icon = ICONS[edition];
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={icon.src} alt={icon.alt} width={size} height={size} />;
}
