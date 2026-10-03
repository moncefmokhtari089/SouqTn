import { createFileRoute } from "@tanstack/react-router";

// The ELmarchii shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/auction")({
  head: () => ({
    meta: [
      { title: "Enchères — ELmarchii" },
      { name: "description", content: "Des objets singuliers aux enchères près de chez vous." },
      { property: "og:title", content: "Enchères — ELmarchii" },
      { property: "og:description", content: "Des objets singuliers aux enchères près de chez vous." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
