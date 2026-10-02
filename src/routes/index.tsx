import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Declare — multiplayer memory card game" },
      {
        name: "description",
        content:
          "Declare is a multiplayer memory card game. Play online with 2–8 friends, pass-and-play on one device, or against the computer.",
      },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Declare — multiplayer memory card game" },
      {
        property: "og:description",
        content:
          "Declare is a multiplayer memory card game. Play online with 2–8 friends, pass-and-play on one device, or against the computer.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ href: "/declare/index.html" });
  },
  component: () => null,
});
