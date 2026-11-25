import { serializeJsonLd } from "@/helpers/blog/seo";

/** One `<script type="application/ld+json">` per node. */
export default function JsonLd({ data }: { data: unknown[] }) {
  return (
    <>
      {data.map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(node) }}
        />
      ))}
    </>
  );
}
