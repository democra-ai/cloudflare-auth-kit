export interface Env {
  // bindings (auto-provisioned by the Deploy to Cloudflare button)
  DB: D1Database;
  KV: KVNamespace;
  ASSETS: Fetcher;
  /** Optional `send_email` binding — enables email-code (OTP) sign-in. Only delivers to
   *  destination addresses verified on your Cloudflare account (Email Routing). */
  EMAIL?: SendEmail;

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
  /**
   * Applications (tenants), as a JSON array. Each gets its own D1 + KV + secret, so users
   * never leak between apps. Empty = one app on DB/KV. See src/apps.ts.
   *   [{"slug":"default","name":"Main"},
   *    {"slug":"citetrack","name":"CiteTrack","db":"DB_CITETRACK","kv":"KV_CITETRACK","secret":"SECRET_CITETRACK"}]
   * Per-app bindings (DB_*, KV_*) and secrets (SECRET_*) are looked up on `env` by name and
   * must be declared in wrangler config — adding an app needs a redeploy.
   */
  APPS?: string;
  /** WebAuthn relying-party id, e.g. ".example.com"-style parent domain "example.com" for
   *  cross-subdomain passkeys. Empty = the request hostname. Fixed at first registration. */
  PASSKEY_RP_ID?: string;
  /** Human-readable name shown in the passkey prompt. Empty = Better Auth's default. */
  PASSKEY_RP_NAME?: string;
  /** "false" disables email+password sign-in (leave passkey + email-code + social only). */
  PASSWORD_LOGIN?: string;
  /** Sender address for sign-in code emails, e.g. "login@yourdomain.com" (must be on a
   *  zone with Email Routing when using the EMAIL binding). Required for email OTP. */
  EMAIL_FROM?: string;

  // secrets (optional)
  /** Resend API key — email OTP to ANY recipient (otherwise the EMAIL binding is used). */
  RESEND_API_KEY?: string;

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
