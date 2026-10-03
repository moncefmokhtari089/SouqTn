import { createFileRoute } from "@tanstack/react-router";

// The SouqTN shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — SouqTN" },
      { name: "description", content: "Les nouvelles de votre quartier." },
      { property: "og:title", content: "Notifications — SouqTN" },
      { property: "og:description", content: "Les nouvelles de votre quartier." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
