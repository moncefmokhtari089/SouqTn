import { createFileRoute } from "@tanstack/react-router";

// The ELmarchii shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Connexion — ELmarchii" },
      { name: "description", content: "Connectez-vous à votre espace ELmarchii." },
      { property: "og:title", content: "Connexion — ELmarchii" },
      { property: "og:description", content: "Connectez-vous à votre espace ELmarchii." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
