import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { admin } from "better-auth/plugins";
import { organization } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { emailOTP } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { emailReady, sendEmail } from "./email";
import type { Env } from "./types";

/**
 * Per-application overrides. Omit for the control-plane instance (the deployment's own
 * `/api/auth`), pass an app for a tenant mounted under `/<slug>/api/auth`.
 *
 * Isolation rests on THREE things, all of them required:
 *   • `secret`       — the session cookie is HMAC-signed with it, so app B cannot forge or
 *                      accept a cookie minted by app A.
 *   • `cookiePrefix` — cookies on one host are identified by NAME; a scoped Path alone is
 *                      ambiguous on the wire (the browser sends both, without path metadata).
 *   • `kv`           — sessions live in KV and `findSession` trusts the KV hit without
 *                      re-checking the database, so a shared KV would defeat a separate D1.
 */
export interface AppAuth {
  db: D1Database;
  kv: KVNamespace;
  secret: string;
  /** e.g. "/citetrack/api/auth" — Better Auth's router strips this itself, no URL rewrite. */
  authBasePath: string;
  cookiePrefix: string;
}

/**
 * Better Auth over Cloudflare D1 (users/accounts/orgs) + KV (sessions).
 *
 * A social provider turns on the moment its client id + secret secrets are present.
 * Social sign-in implicitly creates the user (the Supabase-Auth behaviour): a user who
 * signs in with Google becomes your user, no password, no separate sign-up.
 */
export function createAuth(env: Env, requestOrigin?: string, app?: AppAuth) {
  const secret = app?.secret ?? env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET is missing or too short (<32).");
  }
  const d1 = app?.db ?? env.DB;
  const kv = app?.kv ?? env.KV;
  const db = drizzle(d1, { schema });

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
  // Tenants get host-only cookies: a .democra.ai domain cookie would blanket every app path.
  const cookieDomain = app ? "" : (env.COOKIE_DOMAIN ?? "").trim();

  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    secret,
    ...(baseURL ? { baseURL } : {}),
    ...(app ? { basePath: app.authBasePath } : {}),
    trustedOrigins,
    emailAndPassword: {
      enabled: env.PASSWORD_LOGIN !== "false",
      disableSignUp: env.ALLOW_SIGNUP !== "true",
    },
    ...(Object.keys(socialProviders).length ? { socialProviders } : {}),
    plugins: [
      // The username plugin exposes its OWN password sign-in (/sign-in/username), so it
      // must be dropped in passwordless mode — otherwise disabling emailAndPassword alone
      // would still leave a password login path open.
      ...(env.PASSWORD_LOGIN !== "false" ? [username()] : []),
      admin(),
      organization(),
      // Email-code (OTP) sign-in — on when an email backend is configured (see email.ts).
      ...(emailReady(env)
        ? [
            emailOTP({
              otpLength: 6,
              expiresIn: 600,
              storeOTP: "hashed",
              disableSignUp: env.ALLOW_SIGNUP !== "true",
              async sendVerificationOTP({ email, otp }) {
                const r = await sendEmail(env, {
                  to: email,
                  subject: `${(env.PASSKEY_RP_NAME ?? "").trim() || "Your account"}: sign-in code ${otp}`,
                  text: `Your sign-in code is: ${otp}\n\nIt expires in 10 minutes. If you didn't request it, ignore this email.`,
                });
                if (!r.ok) throw new Error(r.error);
              },
            }),
          ]
        : []),
      // WebAuthn passkeys. Zero-config: rpID defaults to the baseURL hostname and the
      // expected origin to the request's Origin header. Set PASSKEY_RP_ID to a parent
      // domain (e.g. "example.com") to let one passkey work across subdomains — decide
      // BEFORE the first registration; credentials are bound to the rpID forever.
      passkey({
        ...(env.PASSKEY_RP_ID?.trim() ? { rpID: env.PASSKEY_RP_ID.trim() } : {}),
        ...(env.PASSKEY_RP_NAME?.trim() ? { rpName: env.PASSKEY_RP_NAME.trim() } : {}),
      }),
    ],
    advanced: {
      ...(cookieDomain ? { crossSubDomainCookies: { enabled: true, domain: cookieDomain } } : {}),
      // Renames EVERY cookie this instance sets (session_token, passkey challenge, …).
      ...(app ? { cookiePrefix: app.cookiePrefix } : {}),
    },
    secondaryStorage: {
      get: async (key) => kv.get(key),
      set: async (key, value, ttl) => {
        await kv.put(key, value, ttl ? { expirationTtl: Math.max(60, ttl) } : undefined);
      },
      delete: async (key) => {
        await kv.delete(key);
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
