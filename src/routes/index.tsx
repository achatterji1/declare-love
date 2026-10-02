import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

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
      { httpEquiv: "refresh", content: "0;url=/declare/index.html" },
    ],
  }),
  component: HomeRedirect,
});

function HomeRedirect() {
  useEffect(() => {
    window.location.replace("/declare/index.html");
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "system-ui, sans-serif",
        background: "#f3ebe0",
        color: "#3d3229",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>Declare</h1>
        <p style={{ marginBottom: "1rem" }}>Opening the game…</p>
        <a href="/declare/index.html" style={{ color: "#6b4f3a", fontWeight: 600 }}>
          Continue to Declare
        </a>
      </div>
    </main>
  );
}
