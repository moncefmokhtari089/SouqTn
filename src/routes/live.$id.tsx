import { createFileRoute } from "@tanstack/react-router";

// The ELmarchii shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/live/$id")({
  head: () => ({
    meta: [
      { title: "Salon live — ELmarchii" },
      { name: "description", content: "Un vendeur présente ses objets en direct." },
      { property: "og:title", content: "Salon live — ELmarchii" },
      { property: "og:description", content: "Un vendeur présente ses objets en direct." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
