import { createFileRoute } from "@tanstack/react-router";

// The ELmarchii shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/market")({
  head: () => ({
    meta: [
      { title: "Le Market — ELmarchii" },
      { name: "description", content: "Parcourez les annonces d’objets d’occasion et neufs partout en Tunisie." },
      { property: "og:title", content: "Le Market — ELmarchii" },
      { property: "og:description", content: "Parcourez les annonces d’objets d’occasion et neufs partout en Tunisie." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
