import { createFileRoute } from "@tanstack/react-router";

// The ELmarchii shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Mon profil — ELmarchii" },
      { name: "description", content: "Gérez votre profil, vos annonces et vos objets sauvegardés." },
      { property: "og:title", content: "Mon profil — ELmarchii" },
      { property: "og:description", content: "Gérez votre profil, vos annonces et vos objets sauvegardés." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
