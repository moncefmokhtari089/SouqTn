import { createFileRoute } from "@tanstack/react-router";

// The SouqTN shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Le live local — SouqTN" },
      { name: "description", content: "Rencontrez des vendeurs tunisiens en direct." },
      { property: "og:title", content: "Le live local — SouqTN" },
      { property: "og:description", content: "Rencontrez des vendeurs tunisiens en direct." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
