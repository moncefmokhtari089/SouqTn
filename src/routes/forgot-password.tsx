import { createFileRoute } from "@tanstack/react-router";

// The SouqTN shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Mot de passe oublié — SouqTN" },
      { name: "description", content: "Recevez un lien pour réinitialiser votre mot de passe." },
      { property: "og:title", content: "Mot de passe oublié — SouqTN" },
      { property: "og:description", content: "Recevez un lien pour réinitialiser votre mot de passe." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
