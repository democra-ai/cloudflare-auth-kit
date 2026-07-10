import { betterAuthStudio } from "better-auth-studio/cloudflare-workers";
import { createAuth, isAdmin } from "./auth";
import { createStudioApiHandler } from "./studio-api";
import { INIT_SQL, PASSKEY_SQL } from "./db/init-sql";
import { emailReady } from "./email";
import { DEFAULT_SLUG, listApps, matchAppSlug, resolveApp, type ResolvedApp } from "./apps";
import { renderMasterPage } from "./master-page";
import type { Env } from "./types";

const studioApi = createStudioApiHandler();

/**
 * Create/upgrade the schema on first boot, so the Deploy to Cloudflare button needs zero
 * manual migration. The KV flag is versioned: bumping it makes existing deployments
 * re-probe once after an upgrade (e.g. v2 added the passkey table).
 */
const SCHEMA_FLAG = "__schema_ready_v2";
/** Per-app, per-isolate memo so a warm isolate doesn't re-probe on every request. */
const schemaReady = new Set<string>();
async function ensureSchema(app: ResolvedApp): Promise<void> {
  if (schemaReady.has(app.slug)) return;
  if (await app.kv.get(SCHEMA_FLAG)) {
    schemaReady.add(app.slug);
    return;
  }
  const tables = await app.db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('user','passkey')")
    .all();
  const have = new Set((tables.results ?? []).map((r) => (r as { name: string }).name));
  if (!have.has("user")) {
    await app.db.batch([...INIT_SQL, ...PASSKEY_SQL].map((s) => app.db.prepare(s)));
  } else if (!have.has("passkey")) {
    await app.db.batch(PASSKEY_SQL.map((s) => app.db.prepare(s)));
  }
  await app.kv.put(SCHEMA_FLAG, "1");
  schemaReady.add(app.slug);
}

/** Static files the Studio shell needs; always public (JS/CSS/images are not sensitive). */
const STATIC_FILES = new Set([
  "/favicon.svg",
  "/favicon.ico",
  "/logo.png",
  "/shaders.png",
  "/vite.svg",
  "/studio-i18n.js",
  "/studio-theme.css",
]);
const isStatic = (p: string) => p.startsWith("/assets/") || STATIC_FILES.has(p);

/**
 * The Studio frontend hard-codes root-absolute data calls (`fetch("/api/counts")`, ~113 of
 * them). Mounted under `/<slug>`, those would hit the WRONG tenant. The adapter's basePath
 * fixes the shell, the assets and the client-side router, but not the data layer — so we
 * prepend a tiny classic script that re-points `/api/*` at this app.
 *
 * It must run before the app's first fetch: the bundle is `<script type="module">`, which is
 * deferred, while a classic inline script in <head> executes during parse. The Studio's own
 * auth probe already emits `${basePath}/api/auth`, which does not start with "/api/", so it
 * is never double-prefixed.
 */
const fetchShim = (basePath: string) => `<script>(function(){
var B=${JSON.stringify(basePath)},f=window.fetch;
function map(u){
  if(typeof u!=="string") return u;
  // Studio's own session probes ride the basePath. The OPERATOR is authenticated against the
  // control plane, not the tenant, so send those to the root instead.
  if(u.indexOf(B+"/api/auth")===0) return u.slice(B.length);
  if(u.indexOf(B+"/auth/")===0) return "/api/auth/"+u.slice((B+"/auth/").length);
  if(u===B+"/auth") return "/api/auth";
  // Every other Studio data call is hard-coded root-absolute; point it at THIS tenant.
  if(u.indexOf("/api/")===0) return B+u;
  return u;
}
window.fetch=function(u,o){
  if(u&&typeof u==="object"&&typeof u.url==="string"&&u.url.indexOf(location.origin)===0){
    var m=map(u.url.slice(location.origin.length));
    if(m!==u.url.slice(location.origin.length)) u=new Request(location.origin+m,u);
  } else { u=map(u); }
  return f.call(this,u,o);
};
})();</script>`;

/**
 * Brand the Studio HTML without forking its bundle: the fetch shim + a Cloudflare-orange
 * stylesheet in <head> (so it overrides the Studio's own theme variables), and the Chinese
 * DOM overlay appended to <body>. `/studio-theme.css` and `/studio-i18n.js` stay
 * root-absolute — they are served by the host-root static allowlist, not per app.
 */
function withStudioBranding(res: Response, basePath = ""): Response {
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  return new HTMLRewriter()
    .on("head", {
      element(el) {
        if (basePath) el.prepend(fetchShim(basePath), { html: true });
        el.append('<link rel="stylesheet" href="/studio-theme.css">', { html: true });
      },
    })
    .on("body", {
      element(el) {
        el.append('<script src="/studio-i18n.js" defer></script>', { html: true });
      },
    })
    .transform(res);
}

/**
 * Which app started this OAuth flow?
 *
 * All apps share ONE registered callback, so the provider comes back to `/api/auth/callback/x`
 * with no idea which tenant it belongs to. Better Auth keys the pending flow by the `state`
 * value. With `secondaryStorage` configured (we store sessions in KV) `createVerificationValue`
 * writes it to KV as `verification:<state>` — NOT to the `verification` table — and the callback
 * reads it back the same way. So we ask each tenant's KV whether it owns this state.
 *
 * Keying on state is race-free. A shared dispatch cookie would not be: two concurrent sign-ins
 * to different apps in one browser would overwrite each other and misroute the second callback.
 */
async function findAppByState(env: Env, state: string): Promise<ResolvedApp | null> {
  for (const def of listApps(env)) {
    if (def.slug === DEFAULT_SLUG) continue; // the control plane already owns this route
    try {
      const app = resolveApp(env, def.slug);
      if (await app.kv.get(`verification:${state}`)) return app;
    } catch {
      // a tenant with a bad binding simply cannot own this state
    }
  }
  return null;
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
    const url = new URL(request.url);
    const p = url.pathname;
    // The control plane: the operator signs in here, against the deployment's own DB/KV.
    // `/api/auth/*` and `/auth/*` at the root always belong to it, never to a tenant.
    await ensureSchema({ slug: "__control", db: env.DB, kv: env.KV } as ResolvedApp);
    const auth = createAuth(env, url.origin);
    const trusted = [env.AUTH_URL, url.origin, ...(env.TRUSTED_ORIGINS ?? "").split(",")].map((o) => (o ?? "").trim()).filter(Boolean);

    // Multi-application mode is OPT-IN: it only turns on when `APPS` lists more than one app.
    // With a single app the deployment is exactly what it was before — one user pool, one URL,
    // one OAuth callback, Studio mounted at the root.
    const multiApp = listApps(env).length > 1;

    // ── 0. THE ONE OAuth callback, shared by every app ───────────────────────
    // Registered with Google/GitHub exactly once, forever. Every tenant pins its
    // `redirectURI` here (see src/auth.ts), so the provider always returns to this URL; we
    // route it to the app that started the flow. Unmatched states fall through to the
    // control plane, which owns this route natively.
    const cb = multiApp ? p.match(/^\/api\/auth\/callback\/([a-zA-Z0-9_-]+)$/) : null;
    if (cb) {
      const state = url.searchParams.get("state");
      const tenant = state ? await findAppByState(env, state) : null;
      if (tenant) {
        const tenantAuth = createAuth(env, url.origin, {
          db: tenant.db,
          kv: tenant.kv,
          secret: tenant.secret,
          authBasePath: tenant.authBasePath,
          cookiePrefix: tenant.cookiePrefix,
          emailFrom: tenant.emailFrom,
          emailName: tenant.emailName,
          cookieDomain: tenant.cookieDomain,
        });
        const to = new URL(request.url);
        to.pathname = `${tenant.authBasePath}/callback/${cb[1]}`;
        return withCors(
          await tenantAuth.handler(new Request(to.toString(), request)),
          request.headers.get("origin"),
          trusted,
        );
      }
    }

    // ── 1. Better Auth API (PUBLIC — end users sign in here) ──────────────────
    if (p === "/api/auth" || p.startsWith("/api/auth/")) {
      const origin = request.headers.get("origin");
      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }), origin, trusted);
      }
      // Studio's shell boots by GET /api/auth/session (Better Auth exposes get-session), and
      // its route guard reads `authenticated` — not Better Auth's `{session,user}` shape.
      if (p === "/api/auth/session" && request.method === "GET") {
        const s = await auth.api.getSession({ headers: request.headers });
        return withCors(
          new Response(JSON.stringify({ authenticated: Boolean(s?.user), user: s?.user ?? null, session: s?.session ?? null }), {
            headers: { "Content-Type": "application/json" },
          }),
          origin,
          trusted,
        );
      }
      // Studio's account menu signs out via GET /api/auth/logout.
      if (p === "/api/auth/logout") {
        await auth.api.signOut({ headers: request.headers }).catch(() => {});
        return withCors(new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } }), origin, trusted);
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

    // ── 2b. TENANT surfaces (PUBLIC): /<slug>/api/auth/*, /<slug>/auth/*, /<slug>/providers
    // Better Auth's router derives its basePath from the configured baseURL and strips it
    // itself, so the original Request is handed over untouched.
    const publicSlug = multiApp ? matchAppSlug(env, p) : null;
    if (publicSlug) {
      const rest = p.slice(publicSlug.length + 1) || "/";
      const isAuthApi = rest === "/api/auth" || rest.startsWith("/api/auth/");
      const isLoginPage = rest === "/auth" || rest.startsWith("/auth/") || rest === "/login";
      const tenantDef = resolveApp(env, publicSlug);
      // The default app already owns the root auth surface. Re-exposing it under /default
      // would set a same-named but host-only cookie that shadows the control plane's.
      if (tenantDef.isDefault && (isAuthApi || isLoginPage || rest === "/providers")) {
        return Response.redirect(new URL(rest === "/providers" ? "/providers" : rest.replace(/^\/api\/auth/, "/api/auth"), url).toString(), 302);
      }
      if (!tenantDef.isDefault && (isAuthApi || isLoginPage || rest === "/providers")) {
        const tenant = tenantDef;
        await ensureSchema(tenant);

        if (isLoginPage) {
          const u = new URL(request.url);
          u.pathname = "/login.html";
          return env.ASSETS.fetch(new Request(u.toString(), request));
        }
        if (rest === "/providers") {
          return new Response(
            JSON.stringify({
              app: { slug: tenant.slug, name: tenant.name },
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
              callbackBase: `${(env.AUTH_URL ?? "").trim() || url.origin}${tenant.authBasePath}/callback`,
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        const tenantAuth = createAuth(env, url.origin, {
          db: tenant.db,
          kv: tenant.kv,
          secret: tenant.secret,
          authBasePath: tenant.authBasePath,
          cookiePrefix: tenant.cookiePrefix,
          emailFrom: tenant.emailFrom,
          emailName: tenant.emailName,
          cookieDomain: tenant.cookieDomain,
        });
        const origin = request.headers.get("origin");
        if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), origin, trusted);
        if (rest === "/api/auth/session" && request.method === "GET") {
          const session = await tenantAuth.api.getSession({ headers: request.headers });
          return withCors(
            new Response(JSON.stringify(session ?? null), { headers: { "Content-Type": "application/json" } }),
            origin,
            trusted,
          );
        }
        return withCors(await tenantAuth.handler(request), origin, trusted);
      }
    }

    // ── 3. Static assets for the Studio shell (PUBLIC) ───────────────────────
    if (isStatic(p)) return env.ASSETS.fetch(request);

    // ── 4. Everything below is the admin surface ─────────────────────────────
    // Gate on a Better Auth session with role=admin against the CONTROL PLANE. The Studio
    // adapter's own `access` config only checks IPs (it never enforces emails/roles), so we
    // must gate here — otherwise the whole dashboard is world-readable.
    if (!(await isAdmin(auth, env, request))) {
      if (p.startsWith("/api/") || p.includes("/api/")) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
      }
      const to = new URL("/auth/sign-in", url);
      to.searchParams.set("redirectTo", p + url.search);
      return Response.redirect(to.toString(), 302);
    }

    const STUDIO_TOOLS = {
      // Kept out: run-migration is destructive; the rest call endpoints we do not implement
      // (they would render a card and then 501). jwt-decoder + secret-generator are generic
      // dev utilities unconnected to our systems and 501 today, so hide them too. Everything
      // else visible now has a real handler.
      exclude: [
        "run-migration",
        "test-oauth",
        "export-data",
        "password-strength",
        "token-generator",
        "plugin-generator",
        "jwt-decoder",
        "secret-generator",
      ],
    };

    // ── 4a. SINGLE APP (the default): Studio at the root, exactly as before ───
    // No app directory, no path prefix, no fetch shim — one user pool, one callback URL.
    if (!multiApp) {
      const only = resolveApp(env, listApps(env)[0].slug);
      await ensureSchema(only);
      const authBaseURL = `${(env.AUTH_URL ?? "").trim() || url.origin}/api/auth`;
      const studio = betterAuthStudio<Env, ExecutionContext>({
        auth,
        basePath: "",
        assets: (e) => e.ASSETS,
        apiHandler: (req, context) => studioApi({ auth, env, app: only, authBaseURL }, req, context),
        metadata: { title: "User Management", theme: "dark" },
        lastSeenAt: { enabled: false },
        tools: STUDIO_TOOLS,
      });
      return withStudioBranding(await studio(request, env, ctx));
    }

    // ── 4b. The app directory ────────────────────────────────────────────────
    if (p === "/" || p === "/apps") return renderMasterPage(env, (env.AUTH_URL ?? "").trim() || url.origin);

    // ── 4c. One Studio per app, each bound to that app's own database ─────────
    const slug = matchAppSlug(env, p);
    if (!slug) {
      const known = listApps(env).map((a) => a.slug);
      return new Response(JSON.stringify({ error: "unknown app", apps: known }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const app = resolveApp(env, slug);
    await ensureSchema(app);
    const appAuth = createAuth(env, url.origin, {
      db: app.db,
      kv: app.kv,
      secret: app.secret,
      authBasePath: app.authBasePath,
      cookiePrefix: app.cookiePrefix,
      emailFrom: app.emailFrom,
      emailName: app.emailName,
      cookieDomain: app.cookieDomain,
    });
    const authBaseURL = `${(env.AUTH_URL ?? "").trim() || url.origin}${app.authBasePath}`;

    const studio = betterAuthStudio<Env, ExecutionContext>({
      auth: appAuth,
      basePath: `/${slug}`,
      assets: (e) => e.ASSETS,
      apiHandler: (req, context) => studioApi({ auth: appAuth, env, app, authBaseURL }, req, context),
      metadata: { title: `${app.name} · 用户管理`, theme: "dark" },
      lastSeenAt: { enabled: false },
      tools: STUDIO_TOOLS,
    });
    return withStudioBranding(await studio(request, env, ctx), `/${slug}`);
  },
} satisfies ExportedHandler<Env>;
