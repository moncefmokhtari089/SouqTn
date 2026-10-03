import { createFileRoute } from "@tanstack/react-router";

// The SouqTN shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/market/$id")({
  head: () => ({
    meta: [
      { title: "Annonce — SouqTN" },
      { name: "description", content: "Détails de l’annonce, photos et vendeur sur SouqTN." },
      { property: "og:title", content: "Annonce — SouqTN" },
      { property: "og:description", content: "Détails de l’annonce, photos et vendeur sur SouqTN." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
