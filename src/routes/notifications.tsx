import { createFileRoute } from "@tanstack/react-router";

// The ELmarchii shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — ELmarchii" },
      { name: "description", content: "Les nouvelles de votre quartier." },
      { property: "og:title", content: "Notifications — ELmarchii" },
      { property: "og:description", content: "Les nouvelles de votre quartier." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
