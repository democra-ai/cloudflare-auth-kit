import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { admin } from "better-auth/plugins";
import { organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { Env } from "./types";

/**
 * Better Auth over Cloudflare D1 (users/accounts/orgs) + KV (sessions).
 *
 * A social provider turns on the moment its client id + secret secrets are present.
 * Social sign-in implicitly creates the user (the Supabase-Auth behaviour): a user who
 * signs in with Google becomes your user, no password, no separate sign-up.
 */
export function createAuth(env: Env, requestOrigin?: string) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET is missing or too short (<32).");
  }
  const db = drizzle(env.DB, { schema });

  // Zero-config base URL: use AUTH_URL if set, otherwise fall back to the origin the
  // request actually arrived on. This makes the one-click deploy work on the auto-assigned
  // *.workers.dev URL (and any custom domain) without the deployer editing anything.
  const baseURL = (env.AUTH_URL ?? "").trim() || requestOrigin || undefined;

  const socialProviders: Record<string, Record<string, string>> = {};
  const pair = (name: string, id?: string, secret?: string, extra?: Record<string, string | undefined>) => {
    if (!id || !secret) return;
    socialProviders[name] = { clientId: id, clientSecret: secret };
    for (const [k, v] of Object.entries(extra ?? {})) if (v) socialProviders[name][k] = v;
  };
  pair("google", env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  pair("apple", env.APPLE_CLIENT_ID, env.APPLE_CLIENT_SECRET, { appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER });
  pair("github", env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET);
  pair("microsoft", env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET);

  const trustedOrigins = [baseURL, requestOrigin, ...(env.TRUSTED_ORIGINS ?? "").split(",")]
    .map((o) => (o ?? "").trim())
    .filter(Boolean);
  const cookieDomain = (env.COOKIE_DOMAIN ?? "").trim();

  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    secret: env.BETTER_AUTH_SECRET,
    ...(baseURL ? { baseURL } : {}),
    trustedOrigins,
    emailAndPassword: { enabled: true, disableSignUp: env.ALLOW_SIGNUP !== "true" },
    ...(Object.keys(socialProviders).length ? { socialProviders } : {}),
    plugins: [username(), admin(), organization()],
    ...(cookieDomain ? { advanced: { crossSubDomainCookies: { enabled: true, domain: cookieDomain } } } : {}),
    secondaryStorage: {
      get: async (key) => env.KV.get(key),
      set: async (key, value, ttl) => {
        await env.KV.put(key, value, ttl ? { expirationTtl: Math.max(60, ttl) } : undefined);
      },
      delete: async (key) => {
        await env.KV.delete(key);
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** True if the request carries a Better Auth session with role=admin, or an ADMIN_EMAILS email. */
export async function isAdmin(auth: Auth, env: Env, req: Request): Promise<boolean> {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    const user = session?.user as { role?: string; email?: string } | undefined;
    if (!user) return false;
    if (user.role === "admin") return true;
    const allow = (env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    return Boolean(user.email && allow.includes(user.email.toLowerCase()));
  } catch {
    return false;
  }
}
