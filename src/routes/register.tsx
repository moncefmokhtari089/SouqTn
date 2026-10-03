import { createFileRoute } from "@tanstack/react-router";

// The ELmarchii shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Inscription — ELmarchii" },
      { name: "description", content: "Créez votre compte ELmarchii gratuitement." },
      { property: "og:title", content: "Inscription — ELmarchii" },
      { property: "og:description", content: "Créez votre compte ELmarchii gratuitement." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
