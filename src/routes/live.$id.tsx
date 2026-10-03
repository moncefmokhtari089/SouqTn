import { createFileRoute } from "@tanstack/react-router";

// The SouqTN shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/live/$id")({
  head: () => ({
    meta: [
      { title: "Salon live — SouqTN" },
      { name: "description", content: "Un vendeur présente ses objets en direct." },
      { property: "og:title", content: "Salon live — SouqTN" },
      { property: "og:description", content: "Un vendeur présente ses objets en direct." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
