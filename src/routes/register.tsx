import { createFileRoute } from "@tanstack/react-router";

// The SouqTN shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Inscription — SouqTN" },
      { name: "description", content: "Créez votre compte SouqTN gratuitement." },
      { property: "og:title", content: "Inscription — SouqTN" },
      { property: "og:description", content: "Créez votre compte SouqTN gratuitement." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
