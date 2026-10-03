import { createFileRoute } from "@tanstack/react-router";

// The SouqTN shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/messages")({
  head: () => ({
    meta: [
      { title: "Messages — SouqTN" },
      { name: "description", content: "Vos conversations avec les vendeurs." },
      { property: "og:title", content: "Messages — SouqTN" },
      { property: "og:description", content: "Vos conversations avec les vendeurs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
