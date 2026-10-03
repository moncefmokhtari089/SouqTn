import { createFileRoute } from "@tanstack/react-router";

// The ELmarchii shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/market/$id")({
  head: () => ({
    meta: [
      { title: "Annonce — ELmarchii" },
      { name: "description", content: "Détails de l’annonce, photos et vendeur sur ELmarchii." },
      { property: "og:title", content: "Annonce — ELmarchii" },
      { property: "og:description", content: "Détails de l’annonce, photos et vendeur sur ELmarchii." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
