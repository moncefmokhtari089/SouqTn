import { createFileRoute } from "@tanstack/react-router";

// The SouqTN shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Connexion — SouqTN" },
      { name: "description", content: "Connectez-vous à votre espace SouqTN." },
      { property: "og:title", content: "Connexion — SouqTN" },
      { property: "og:description", content: "Connectez-vous à votre espace SouqTN." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
