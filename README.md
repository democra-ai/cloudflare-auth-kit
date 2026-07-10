# Cloudflare Auth Kit

**Your own user-management backend — auth, login page, and admin dashboard — running entirely on Cloudflare. One click to deploy. Free and open source.**

A self-hosted, Supabase-Auth-style stack you fully own:

- 🔐 **Backend** — [Better Auth](https://www.better-auth.com) on a Cloudflare Worker, storing users & organizations in **D1** and sessions in **KV**. Email + password and social login (Google, Apple, GitHub, Microsoft).
- 🖥️ **Hosted login pages** — built from [better-auth-ui](https://github.com/daveyplate/better-auth-ui) (shadcn/ui components made for Better Auth), themed in Cloudflare's classic orange with light & dark mode. Sign-in, sign-up, **passkeys**, and the full auth flow at `/auth/*`, showing exactly the providers you configure.
- 📊 **Admin dashboard** — [Better Auth Studio](https://github.com/Kinfe123/better-auth-studio) to browse, create, ban, role, and delete users and organizations — behind an admin-only gate.

Everything is one Worker. No servers, no external database, no third-party auth vendor. It runs comfortably inside the [Cloudflare free tier](https://developers.cloudflare.com/workers/platform/pricing/).

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/democra-ai/cloudflare-auth-kit">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" />
  </a>
</p>

---

## What you get

| | |
|---|---|
| **Sign-in methods** | Email + password, **email codes (OTP)**, **passkeys (WebAuthn)**, Google, Apple, GitHub, Microsoft (each social provider turns on automatically once you provide its client id + secret) |
| **Data** | Users, accounts, sessions, organizations & members — in your own Cloudflare D1 database |
| **Sessions** | Stored in Cloudflare KV; optional cross-subdomain SSO cookie |
| **Admin UI** | Better Auth Studio at the Worker root, gated to admins only |
| **End-user UI** | Hosted [better-auth-ui](https://github.com/daveyplate/better-auth-ui) pages at `/auth/*` (sign-in, sign-up, …) in Cloudflare orange, light & dark |
| **Cost** | $0 on the Cloudflare free tier for typical small/medium apps |
| **Ownership** | 100% yours — your Cloudflare account, your database, your code, MIT-licensed |

---

## Architecture

```
                         ┌──────────────────────────────────────────────┐
   End users  ─────────► │  Cloudflare Worker (this repo)                │
   (Google / password)   │                                              │
                         │   /auth/*             → login pages           │
   Your app  ──────────► │                         (better-auth-ui)      │
   (SDK / redirect)      │   /api/auth/*         → Better Auth (public)  │
                         │                                              │
                         │   /  and everything   → Better Auth Studio    │
   You (admin)  ───────► │     else              → admin dashboard       │
                         │                          (role=admin only)    │
                         └───────────┬───────────────────┬──────────────┘
                                     │                   │
                              ┌──────▼──────┐     ┌──────▼──────┐
                              │  D1 (SQL)   │     │  KV (KV)    │
                              │ users/orgs  │     │  sessions   │
                              └─────────────┘     └─────────────┘
```

One Worker serves three surfaces on three path groups. The auth API is public (that's how your users sign in); everything else is gated to admins.

---

## One-click deploy

1. Click **Deploy to Cloudflare** above.
2. Cloudflare clones this repo into **your** GitHub account and provisions a **D1 database** and a **KV namespace** for you automatically.
3. When prompted, paste one secret:
   - **`BETTER_AUTH_SECRET`** — 32+ random characters that sign your sessions. Generate one with:
     ```sh
     openssl rand -base64 33
     ```
   - (Optional) any social-login client ids/secrets you want on from day one — you can also add these later.
4. Deploy. Your Worker goes live at `https://cloudflare-auth-kit.<your-subdomain>.workers.dev`.

The database schema is created automatically on first request — there is **no migration step** to run. `AUTH_URL` is auto-detected from the request, so it works on the `workers.dev` URL out of the box.

> Every push to your new repo redeploys automatically (Cloudflare Workers Builds is wired up for you).

### Create your first admin

The dashboard is locked to admins, so bootstrap the first one once:

1. **Temporarily allow sign-up.** In the Cloudflare dashboard → your Worker → *Settings → Variables*, set `ALLOW_SIGNUP = true` and redeploy (or `wrangler deploy`).
2. Visit `https://<your-worker-url>/auth/sign-up` and sign up with your email + password (or a social provider).
3. **Make yourself admin** — two ways, pick one:
   - **Easiest:** set the `ADMIN_EMAILS` variable to your email (comma-separated for several). Anyone in that list is treated as an admin.
   - **Or** promote the row directly:
     ```sh
     wrangler d1 execute auth-kit-db --remote \
       --command "UPDATE user SET role='admin' WHERE email='you@example.com';"
     ```
4. **Turn sign-up back off:** set `ALLOW_SIGNUP = false` (or remove it) and redeploy. New users can still arrive via social login and the admin dashboard; only public password self-registration is closed.
5. Visit your Worker root — you're in the dashboard.

---

## Use your own domain

The deploy button does **not** set a custom domain (that step is always manual). To serve auth from `auth.yourdomain.com`:

1. Add your domain to Cloudflare (if it isn't already).
2. Worker → **Settings → Domains & Routes → Add → Custom Domain** → e.g. `auth.yourdomain.com`. Cloudflare issues the certificate automatically.
3. That's it — `AUTH_URL` auto-detects the new origin. (If you prefer to pin it, set the `AUTH_URL` variable to `https://auth.yourdomain.com`.)
4. **Sharing login across subdomains (SSO):** set `COOKIE_DOMAIN = .yourdomain.com` so a session created at `auth.yourdomain.com` is valid at `app.yourdomain.com`. List your app origins in `TRUSTED_ORIGINS` (comma-separated) so they may call the auth API with credentials.

---

## Add social login

A provider switches on the instant both of its secrets are present. Set them in Worker → *Settings → Variables* (as **secrets**), then redeploy.

| Provider | Variables | Redirect URI to register with the provider |
|---|---|---|
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `<AUTH_URL>/api/auth/callback/google` |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `<AUTH_URL>/api/auth/callback/github` |
| Apple | `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`, `APPLE_APP_BUNDLE_IDENTIFIER` | `<AUTH_URL>/api/auth/callback/apple` |
| Microsoft | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | `<AUTH_URL>/api/auth/callback/microsoft` |

Signing in with a social provider **creates the user automatically** — no separate sign-up, exactly like Supabase Auth. Register the redirect URI above in each provider's console (replace `<AUTH_URL>` with your Worker/custom-domain URL).

---

## Passkeys

Passkeys (WebAuthn) work **out of the box** — no configuration, no extra service:

1. Sign in with your password at `/auth/sign-in`.
2. You'll see a **Passkeys** card — click **Add Passkey** and follow your browser/OS prompt (Touch ID, Windows Hello, phone, security key).
3. Next time, click **Sign in with Passkey** instead of typing a password.

By default a passkey is bound to the exact hostname. If you run several subdomains against one user base and want a single passkey to work on all of them, set `PASSKEY_RP_ID` to the parent domain (e.g. `example.com`) **before anyone registers a passkey** — the relying-party id is baked into each credential and can't be changed later. `PASSKEY_RP_NAME` sets the display name in the passkey prompt.

---

## Email-code sign-in (OTP) & going passwordless

Prefer codes over passwords? Configure an email backend and the login page grows a **Send code** flow (6-digit code, 10-minute expiry, stored hashed, rate-limited):

- **Resend** (any recipient): set the `RESEND_API_KEY` secret and the `EMAIL_FROM` var.
- **Cloudflare Email Routing** (free; delivers only to destination addresses verified on your account — ideal for admin sign-in): uncomment the `send_email` binding in `wrangler.jsonc` and set `EMAIL_FROM` to an address on your zone.

To go **fully passwordless**, set `PASSWORD_LOGIN = false` — the password form disappears and the API rejects password sign-ins; users authenticate with email codes, passkeys, or social login. (Do this after you can receive codes or have registered a passkey, or you'll lock yourself out.)

---

## Connect your app

Your application talks to the public auth API. Use the [Better Auth client](https://www.better-auth.com/docs/installation) pointed at your Worker:

```ts
import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
  baseURL: "https://auth.yourdomain.com", // your Worker / custom domain
});

// e.g. social sign-in
await authClient.signIn.social({ provider: "google" });
// or email + password
await authClient.signIn.email({ email, password });
// read the current user
const { data } = await authClient.getSession();
```

Or just send users to the built-in page: `https://auth.yourdomain.com/auth/sign-in?redirectTo=/` (the legacy `/login` path works too). After signing in, users land on `redirectTo`.

---

## Local development

```sh
git clone https://github.com/democra-ai/cloudflare-auth-kit
cd cloudflare-auth-kit
npm install                     # also copies the Studio UI into ./public

echo 'BETTER_AUTH_SECRET="'$(openssl rand -base64 33)'"' >  .dev.vars
echo 'ALLOW_SIGNUP="true"'                                >> .dev.vars

npm run dev                     # http://localhost:8787
```

Then open `http://localhost:8787/auth/sign-up`, sign up, and promote yourself:

```sh
wrangler d1 execute auth-kit-db --local \
  --command "UPDATE user SET role='admin' WHERE email='you@example.com';"
```

The schema auto-creates on first request locally too.

### Deploy by hand (instead of the button)

```sh
npm run db:create      # creates the D1 + KV, prints their ids
# paste the printed ids into wrangler.jsonc (database_id / kv id)
wrangler secret put BETTER_AUTH_SECRET
npm run deploy
```

---

## Configuration reference

**Variables** (Worker → Settings → Variables — plain text unless noted):

| Name | Required | Purpose |
|---|---|---|
| `BETTER_AUTH_SECRET` | ✅ (secret) | Signs sessions. 32+ random chars. |
| `AUTH_URL` | — | Canonical origin. Empty = auto-detect the request origin (recommended). |
| `ADMIN_EMAILS` | — | Comma-separated emails allowed into the dashboard (besides `role=admin` users). |
| `ALLOW_SIGNUP` | — | `true` opens public password sign-up. Leave off in production. |
| `COOKIE_DOMAIN` | — | e.g. `.yourdomain.com` to share sessions across subdomains. |
| `PASSKEY_RP_ID` | — | Parent domain for cross-subdomain passkeys (e.g. `yourdomain.com`). Empty = request hostname. Fix before first registration. |
| `PASSKEY_RP_NAME` | — | Display name in the passkey prompt. |
| `TRUSTED_ORIGINS` | — | Extra app origins allowed to call the auth API with credentials. |
| `GOOGLE_* / GITHUB_* / APPLE_* / MICROSOFT_*` | — (secret) | Social login credentials. |

**Bindings** (auto-provisioned by the deploy button):

| Binding | Type | Stores |
|---|---|---|
| `DB` | D1 | users, accounts, sessions metadata, organizations, members |
| `KV` | KV | active login sessions |
| `ASSETS` | Static assets | the login page + Studio dashboard UI |

---

## Security notes

- **The dashboard is admin-only.** The Worker checks every non-public request for a Better Auth session with `role=admin` (or an `ADMIN_EMAILS` match) before handing off to Studio. The auth API (`/api/auth/*`) and the `/auth/*` login pages are intentionally public.
- **Keep `ALLOW_SIGNUP` off** in production unless you want open password registration. Social login and admin-created users are unaffected by it.
- **Rotate nothing into git.** Secrets live in Cloudflare, never in the repo. `.dev.vars` is git-ignored.
- Want an extra layer? Put the Worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) to require SSO before anyone even reaches the login page (useful for internal-only tools).

---

## Staying up to date

Both UIs come from actively developed open-source projects, pinned as npm dependencies — the admin dashboard from [Better Auth Studio](https://github.com/Kinfe123/better-auth-studio) and the login pages from [better-auth-ui](https://github.com/daveyplate/better-auth-ui). Update by bumping versions:

```sh
npm update better-auth-studio better-auth
npm run build   # re-copies the Studio UI and rebuilds the login pages into ./public
npm run deploy
```

We also maintain a continuously-synced fork at [democra-ai/better-auth-studio](https://github.com/democra-ai/better-auth-studio) that mirrors upstream daily.

---

## How it fits together

- `src/index.ts` — the Worker: schema auto-migrate, public auth API + login pages, admin gate, Studio mount.
- `src/auth.ts` — Better Auth configured over D1 + KV, with data-driven social providers.
- `src/studio-api.ts` — a complete read/write API handler backing the Studio dashboard on Workers (reads via Drizzle, writes via Better Auth's admin/organization APIs).
- `src/db/` — the generated schema and the boot-time init SQL.
- `login/` — the login pages: a small Vite + React app around [better-auth-ui](https://github.com/daveyplate/better-auth-ui), themed in Cloudflare's brand orange (`#F6821F`). Built into `./public` automatically (wrangler runs `npm run build` before `dev` and `deploy`).
- `wrangler.jsonc` — bindings, variables, and the custom build command.

---

## License

[MIT](./LICENSE). Built on the excellent [Better Auth](https://github.com/better-auth/better-auth), [Better Auth Studio](https://github.com/Kinfe123/better-auth-studio), and [better-auth-ui](https://github.com/daveyplate/better-auth-ui) projects.
