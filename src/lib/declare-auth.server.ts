import { googleSignInEnabled } from "./declare-chips";

function supabasePublic(): { url: string; key: string } | null {
  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export async function authConfig(): Promise<{ url: string; key: string; google: boolean }> {
  const pub = supabasePublic();
  if (!pub) throw new Error("Realtime not configured.");
  let google = false;
  try {
    const res = await fetch(pub.url + "/auth/v1/settings", { headers: { apikey: pub.key } });
    if (res.ok) google = googleSignInEnabled(await res.json());
  } catch {
    google = false;
  }
  return { url: pub.url, key: pub.key, google };
}

export async function readSessionUser(request: Request): Promise<{ id: string; email: string | null } | null> {
  const pub = supabasePublic();
  if (!pub) return null;
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (token.split(".").length !== 3) return null;
  const res = await fetch(pub.url + "/auth/v1/user", {
    headers: { apikey: pub.key, Authorization: "Bearer " + token },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string; email?: string | null };
  if (!user.id) return null;
  return { id: user.id, email: user.email ?? null };
}

export async function requireUser(request: Request): Promise<{ id: string; email: string | null }> {
  const user = await readSessionUser(request);
  if (!user) throw new Error("unauthorized");
  return user;
}
