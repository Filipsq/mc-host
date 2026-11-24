// Structured data for Google (schema.org), so results can show the FAQ,
// breadcrumbs and the site's name. "<" is escaped so text can't close the tag.
export default function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
