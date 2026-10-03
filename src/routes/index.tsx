import { createFileRoute } from "@tanstack/react-router";

// The SouqTN shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SouqTN — Le marché d’à côté" },
      { name: "description", content: "Achetez et vendez près de chez vous en Tunisie : annonces, enchères et lives locaux." },
      { property: "og:title", content: "SouqTN — Le marché d’à côté" },
      { property: "og:description", content: "Achetez et vendez près de chez vous en Tunisie : annonces, enchères et lives locaux." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
