import { createFileRoute } from "@tanstack/react-router";

// The SouqTN shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/auction/$id")({
  head: () => ({
    meta: [
      { title: "Enchère — SouqTN" },
      { name: "description", content: "Suivez une enchère et placez votre mise sur SouqTN." },
      { property: "og:title", content: "Enchère — SouqTN" },
      { property: "og:description", content: "Suivez une enchère et placez votre mise sur SouqTN." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
