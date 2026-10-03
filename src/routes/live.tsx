import { createFileRoute } from "@tanstack/react-router";

// The ELmarchii shell (rendered in __root) draws every page from the current URL.
export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Le live local — ELmarchii" },
      { name: "description", content: "Rencontrez des vendeurs tunisiens en direct." },
      { property: "og:title", content: "Le live local — ELmarchii" },
      { property: "og:description", content: "Rencontrez des vendeurs tunisiens en direct." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
