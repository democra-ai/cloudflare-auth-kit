import { betterAuthStudio } from "better-auth-studio/cloudflare-workers";
import { createAuth, isAdmin } from "./auth";
import { createStudioApiHandler } from "./studio-api";
import { INIT_SQL, PASSKEY_SQL } from "./db/init-sql";
import { emailReady } from "./email";
import type { Env } from "./types";

const studioApi = createStudioApiHandler();

/**
 * Create/upgrade the schema on first boot, so the Deploy to Cloudflare button needs zero
 * manual migration. The KV flag is versioned: bumping it makes existing deployments
 * re-probe once after an upgrade (e.g. v2 added the passkey table).
 */
const SCHEMA_FLAG = "__schema_ready_v2";
let schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  if (await env.KV.get(SCHEMA_FLAG)) {
    schemaReady = true;
    return;
  }
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('user','passkey')",
  ).all();
  const have = new Set((tables.results ?? []).map((r) => (r as { name: string }).name));
  if (!have.has("user")) {
    await env.DB.batch([...INIT_SQL, ...PASSKEY_SQL].map((s) => env.DB.prepare(s)));
  } else if (!have.has("passkey")) {
    await env.DB.batch(PASSKEY_SQL.map((s) => env.DB.prepare(s)));
  }
  await env.KV.put(SCHEMA_FLAG, "1");
  schemaReady = true;
}

/** Static files the Studio shell needs; always public (JS/CSS/images are not sensitive). */
const STATIC_FILES = new Set(["/favicon.svg", "/favicon.ico", "/logo.png", "/shaders.png", "/vite.svg", "/studio-i18n.js"]);
const isStatic = (p: string) => p.startsWith("/assets/") || STATIC_FILES.has(p);

/** Inject the Simplified-Chinese overlay into a Studio HTML response (no fork of the Studio bundle). */
function withStudioI18n(res: Response): Response {
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  return new HTMLRewriter()
    .on("body", {
      element(el) {
        el.append('<script src="/studio-i18n.js" defer></script>', { html: true });
      },
    })
    .transform(res);
}

function withCors(res: Response, origin: string | null, trusted: string[]): Response {
  const h = new Headers(res.headers);
  const allow = origin && trusted.includes(origin) ? origin : trusted[0] ?? "*";
  h.set("Access-Control-Allow-Origin", allow);
  h.set("Access-Control-Allow-Credentials", "true");
  h.set("Vary", "Origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await ensureSchema(env);
    const url = new URL(request.url);
    const p = url.pathname;
    const auth = createAuth(env, url.origin);
    const trusted = [env.AUTH_URL, url.origin, ...(env.TRUSTED_ORIGINS ?? "").split(",")].map((o) => (o ?? "").trim()).filter(Boolean);

    // ── 1. Better Auth API (PUBLIC — end users sign in here) ──────────────────
    if (p === "/api/auth" || p.startsWith("/api/auth/")) {
      const origin = request.headers.get("origin");
      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }), origin, trusted);
      }
      // Studio's shell boots by GET /api/auth/session; Better Auth exposes get-session.
      if (p === "/api/auth/session" && request.method === "GET") {
        const session = await auth.api.getSession({ headers: request.headers });
        return withCors(new Response(JSON.stringify(session ?? null), { headers: { "Content-Type": "application/json" } }), origin, trusted);
      }
      return withCors(await auth.handler(request), origin, trusted);
    }

    // ── 1b. Public provider status (the login page shows the right options) ──
    if (p === "/providers") {
      return new Response(
        JSON.stringify({
          providers: {
            google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
            apple: Boolean(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET),
            github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
            microsoft: Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET),
          },
          signup: env.ALLOW_SIGNUP === "true",
          passkey: true,
          password: env.PASSWORD_LOGIN !== "false",
          emailOTP: emailReady(env),
          callbackBase: `${(env.AUTH_URL ?? "").trim() || url.origin}/api/auth/callback`,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // ── 2. Hosted login page (PUBLIC) — the better-auth-ui SPA ───────────────
    // Built by Vite into /login.html; the URL path picks the view (/auth/sign-in,
    // /auth/sign-up, /auth/forgot-password, ...). The assets binding runs with
    // html_handling:"none", so we map every auth view to /login.html ourselves.
    if (p === "/login" || p === "/login.html" || p === "/auth" || p.startsWith("/auth/")) {
      const u = new URL(request.url);
      u.pathname = "/login.html";
      return env.ASSETS.fetch(new Request(u.toString(), request));
    }

    // ── 3. Static assets for the Studio shell (PUBLIC) ───────────────────────
    if (isStatic(p)) return env.ASSETS.fetch(request);

    // ── 4. Everything else = the admin Studio (UI shell + its /api/*) ─────────
    // Gate on a Better Auth session with role=admin. The Studio adapter's own
    // `access` config only checks IPs (it never enforces emails/roles), so we
    // must gate here — otherwise the whole dashboard is world-readable.
    if (!(await isAdmin(auth, env, request))) {
      if (p.startsWith("/api/")) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
      }
      const to = new URL("/auth/sign-in", url);
      to.searchParams.set("redirectTo", p + url.search);
      return Response.redirect(to.toString(), 302);
    }

    const studio = betterAuthStudio<Env, ExecutionContext>({
      auth,
      basePath: "",
      assets: (e) => e.ASSETS,
      apiHandler: (req, context) => studioApi(auth, env, req, context),
      metadata: { title: "User Management", theme: "dark" },
      lastSeenAt: { enabled: false },
      tools: { exclude: ["run-migration", "test-db", "validate-config", "oauth-credentials"] },
    });
    return withStudioI18n(await studio(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;
