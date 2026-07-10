import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { APP_BASE } from "./app-slug";

// Better Auth's client only appends "/api/auth" when baseURL is a bare origin; give it a
// baseURL that already has a path and it uses that verbatim. So spell the endpoint out.
// For a tenant this is `${origin}/<slug>/api/auth` — exactly where that app's Better Auth
// is mounted — so a login page under /<slug> can never talk to another app's user pool.
export const authClient = createAuthClient({
  baseURL: `${window.location.origin}${APP_BASE}/api/auth`,
  plugins: [passkeyClient(), emailOTPClient()],
});
