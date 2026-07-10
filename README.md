# Cloudflare Auth Kit

**Your own user-management backend — auth, login page, and admin dashboard — running entirely on Cloudflare. One click to deploy. Free and open source.**

A self-hosted, Supabase-Auth-style stack you fully own:

- 🔐 **Backend** — [Better Auth](https://www.better-auth.com) on a Cloudflare Worker, storing users & organizations in **D1** and sessions in **KV**. Email + password and social login (Google, Apple, GitHub, Microsoft).
- 🖥️ **Hosted login page** — a clean, ready-to-use sign-in page your end users hit. Turns on exactly the providers you configure.
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
| **Sign-in methods** | Email + password, Google, Apple, GitHub, Microsoft (each turns on automatically once you provide its client id + secret) |
| **Data** | Users, accounts, sessions, organizations & members — in your own Cloudflare D1 database |
| **Sessions** | Stored in Cloudflare KV; optional cross-subdomain SSO cookie |
| **Admin UI** | Better Auth Studio at the Worker root, gated to admins only |
| **End-user UI** | Hosted `/login` page you can point your app at, or replace with your own |
| **Cost** | $0 on the Cloudflare free tier for typical small/medium apps |
| **Ownership** | 100% yours — your Cloudflare account, your database, your code, MIT-licensed |

---

## Architecture

```
                         ┌──────────────────────────────────────────────┐
   End users  ─────────► │  Cloudflare Worker (this repo)                │
   (Google / password)   │                                              │
                         │   /login              → hosted login page     │
   Your app  ──────────► │   /api/auth/*         → Better Auth (public)  │
   (SDK / redirect)      │                                              │
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
2. Visit `https://<your-worker-url>/login` and sign up with your email + password (or a social provider).
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

Or just send users to the built-in page: `https://auth.yourdomain.com/login?redirect_to=https://app.yourdomain.com`.

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

Then open `http://localhost:8787/login`, sign up, and promote yourself:

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

- **The dashboard is admin-only.** The Worker checks every non-public request for a Better Auth session with `role=admin` (or an `ADMIN_EMAILS` match) before handing off to Studio. The auth API (`/api/auth/*`) and the `/login` page are intentionally public.
- **Keep `ALLOW_SIGNUP` off** in production unless you want open password registration. Social login and admin-created users are unaffected by it.
- **Rotate nothing into git.** Secrets live in Cloudflare, never in the repo. `.dev.vars` is git-ignored.
- Want an extra layer? Put the Worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) to require SSO before anyone even reaches the login page (useful for internal-only tools).

---

## Staying up to date

The admin dashboard is built from [Better Auth Studio](https://github.com/Kinfe123/better-auth-studio), which is actively developed. This kit pins it as an npm dependency, so you get updates by bumping the version:

```sh
npm update better-auth-studio better-auth
npm run build   # re-copies the refreshed Studio UI into ./public
npm run deploy
```

We also maintain a continuously-synced fork at [democra-ai/better-auth-studio](https://github.com/democra-ai/better-auth-studio) that mirrors upstream daily.

---

## How it fits together

- `src/index.ts` — the Worker: schema auto-migrate, public auth API + login page, admin gate, Studio mount.
- `src/auth.ts` — Better Auth configured over D1 + KV, with data-driven social providers.
- `src/studio-api.ts` — a complete read/write API handler backing the Studio dashboard on Workers (reads via Drizzle, writes via Better Auth's admin/organization APIs).
- `src/db/` — the generated schema and the boot-time init SQL.
- `public/login.html` — the hosted login page.
- `wrangler.jsonc` — bindings + variables.

---

## License

[MIT](./LICENSE). Built on the excellent [Better Auth](https://github.com/better-auth/better-auth) and [Better Auth Studio](https://github.com/Kinfe123/better-auth-studio) projects.
