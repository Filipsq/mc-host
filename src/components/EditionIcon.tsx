/** A grass block for Java and a dark stone block for Bedrock. */
export default function EditionIcon({ edition, size = 36 }: { edition: "JAVA" | "BEDROCK"; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={edition === "JAVA" ? "/art/block-grass.svg" : "/art/block-stone.svg"}
      alt={edition === "JAVA" ? "Java" : "Bedrock"}
      width={size}
      height={size}
    />
  );
}
