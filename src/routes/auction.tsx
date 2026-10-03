import { createFileRoute } from "@tanstack/react-router";

// The SouqTN shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/auction")({
  head: () => ({
    meta: [
      { title: "Enchères — SouqTN" },
      { name: "description", content: "Des objets singuliers aux enchères près de chez vous." },
      { property: "og:title", content: "Enchères — SouqTN" },
      { property: "og:description", content: "Des objets singuliers aux enchères près de chez vous." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
