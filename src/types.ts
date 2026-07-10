export interface Env {
  // bindings (auto-provisioned by the Deploy to Cloudflare button)
  DB: D1Database;
  KV: KVNamespace;
  ASSETS: Fetcher;

  // vars (wrangler.jsonc [vars] — editable at deploy time)
  AUTH_URL: string;
  /** Cookie domain for cross-subdomain SSO, e.g. ".example.com". Empty = host-only. */
  COOKIE_DOMAIN?: string;
  /** Comma-separated origins allowed to call the auth API with credentials. */
  TRUSTED_ORIGINS?: string;
  /** Emails allowed into the admin studio (in addition to any user with role=admin). */
  ADMIN_EMAILS?: string;
  /** "true" (transient) opens public password sign-up so you can seed the first admin. */
  ALLOW_SIGNUP?: string;

  // secrets (prompted by the deploy UI via .dev.vars.example)
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
  APPLE_APP_BUNDLE_IDENTIFIER?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
}
