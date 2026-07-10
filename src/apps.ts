import type { Env } from "./types";

/**
 * Applications = tenants. Each one has its OWN D1 database, its OWN KV namespace, and its
 * OWN signing secret, so users never leak between apps.
 *
 * Cloudflare bindings must be declared statically in wrangler config, so the registry maps
 * a slug to the BINDING NAMES; adding an app means adding bindings + a registry row +
 * a redeploy. That is the price of hard isolation.
 *
 * Configure with the `APPS` var, a JSON array:
 *   [{"slug":"default","name":"Main"},
 *    {"slug":"citetrack","name":"CiteTrack","db":"DB_CITETRACK","kv":"KV_CITETRACK","secret":"SECRET_CITETRACK"}]
 * Omit APPS entirely for a single-app deployment (the default app on DB/KV).
 */
export interface AppDef {
  slug: string;
  name?: string;
  /** D1 binding name. Default "DB". */
  db?: string;
  /** KV binding name. Default "KV". */
  kv?: string;
  /** Name of the env var holding this app's signing secret. Default "BETTER_AUTH_SECRET". */
  secret?: string;
  /** From-address for this app's sign-in code emails. Default `<slug>@<zone>` ("login@<zone>" for the default app). */
  emailFrom?: string;
  /** Display name on those emails. Default the app's `name`. */
  emailName?: string;
  /**
   * Scope this tenant's session cookie to COOKIE_DOMAIN (e.g. ".democra.ai") instead of
   * host-only. Needed when the product's OWN web origin must read the session
   * (candy.democra.ai → candy-api.democra.ai). Still isolated by cookie name + secret.
   */
  crossSubDomain?: boolean;
}

export interface ResolvedApp {
  slug: string;
  name: string;
  db: D1Database;
  kv: KVNamespace;
  secret: string;
  /** Better Auth basePath for this app's endpoints, e.g. "/citetrack/api/auth". */
  authBasePath: string;
  /** Cookie name prefix. MUST differ per app: cookies are isolated by NAME, not by path. */
  cookiePrefix: string;
  /** Sender address for this app's sign-in code emails, e.g. "citetrack@democra.ai". */
  emailFrom: string;
  /** Display name shown on this app's sign-in code emails, e.g. "CiteTrack". */
  emailName: string;
  /** Cookie domain for this tenant (COOKIE_DOMAIN if crossSubDomain, else "" = host-only). */
  cookieDomain: string;
  isDefault: boolean;
}

export const DEFAULT_SLUG = "default";

/** A slug that would shadow one of the Worker's own routes or static files. */
export const RESERVED_SLUGS = new Set([
  "api",
  "auth",
  "assets",
  "login",
  "login.html",
  "providers",
  "apps",
  "index.html",
  "favicon.svg",
  "favicon.ico",
  "logo.png",
  "shaders.png",
  "vite.svg",
  "studio-i18n.js",
  "studio-theme.css",
]);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}$/;

/** Parse + validate the registry. Throws loudly rather than silently serving the wrong tenant. */
export function listApps(env: Env): AppDef[] {
  const raw = (env.APPS ?? "").trim();
  if (!raw) return [{ slug: DEFAULT_SLUG, name: "Default" }];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("APPS is not valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("APPS must be a non-empty JSON array");
  }

  const seen = new Set<string>();
  for (const a of parsed as AppDef[]) {
    if (!a || typeof a.slug !== "string" || !SLUG_RE.test(a.slug)) {
      throw new Error(`APPS: invalid slug ${JSON.stringify(a?.slug)} (a-z, 0-9, "-", max 39)`);
    }
    if (RESERVED_SLUGS.has(a.slug)) throw new Error(`APPS: slug "${a.slug}" is reserved`);
    if (seen.has(a.slug)) throw new Error(`APPS: duplicate slug "${a.slug}"`);
    seen.add(a.slug);
  }
  return parsed as AppDef[];
}

/** Resolve a slug to its live bindings. Throws if a binding named in the registry is absent. */
export function resolveApp(env: Env, slug: string): ResolvedApp {
  const def = listApps(env).find((a) => a.slug === slug);
  if (!def) throw new Error(`unknown app "${slug}"`);

  const bag = env as unknown as Record<string, unknown>;
  const dbName = def.db ?? "DB";
  const kvName = def.kv ?? "KV";
  const secretName = def.secret ?? "BETTER_AUTH_SECRET";

  const db = bag[dbName] as D1Database | undefined;
  const kv = bag[kvName] as KVNamespace | undefined;
  const secret = bag[secretName] as string | undefined;

  if (!db || typeof db.prepare !== "function") throw new Error(`app "${slug}": missing D1 binding "${dbName}"`);
  if (!kv || typeof kv.get !== "function") throw new Error(`app "${slug}": missing KV binding "${kvName}"`);
  if (!secret || secret.length < 32) throw new Error(`app "${slug}": missing or too-short secret "${secretName}"`);

  const isDefault = def.slug === DEFAULT_SLUG;
  // Per-product sender. Every product's sign-in code comes from its own local-part on the
  // verified zone (Email Routing verifies senders at the DOMAIN level, so any `<x>@<zone>`
  // works with no extra config), so a recipient can tell which product a code is for.
  const zone = ((env.EMAIL_FROM ?? "login@democra.ai").split("@")[1] || "democra.ai").trim();
  const emailFrom =
    def.emailFrom?.trim() ||
    (isDefault ? (env.EMAIL_FROM ?? "").trim() || `login@${zone}` : `${def.slug}@${zone}`);
  const emailName = def.emailName?.trim() || def.name?.trim() || (isDefault ? "Democra AI" : def.slug);
  // The default app is always zone-wide (SSO across the org). A tenant is host-only unless it
  // opts in — a web product whose own origin reads the session needs the zone scope.
  const cookieDomain = isDefault || def.crossSubDomain ? (env.COOKIE_DOMAIN ?? "").trim() : "";
  return {
    slug: def.slug,
    name: def.name?.trim() || def.slug,
    db,
    kv,
    secret,
    authBasePath: `/${def.slug}/api/auth`,
    // Cookies on one host are distinguished by NAME (path alone is ambiguous on the wire),
    // so every app gets its own prefix. Combined with a per-app secret, an app can neither
    // read nor forge another app's session cookie.
    cookiePrefix: isDefault ? "better-auth" : `ba-${def.slug}`,
    emailFrom,
    emailName,
    cookieDomain,
    isDefault,
  };
}

/** The first path segment, if it names a registered app. */
export function matchAppSlug(env: Env, pathname: string): string | null {
  const seg = pathname.split("/")[1] ?? "";
  if (!seg || RESERVED_SLUGS.has(seg)) return null;
  return listApps(env).some((a) => a.slug === seg) ? seg : null;
}
