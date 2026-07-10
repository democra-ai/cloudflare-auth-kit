import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";
import { emailOTPClient } from "better-auth/client/plugins";

// Same-origin Worker serves Better Auth at /api/auth (its default basePath).
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [passkeyClient(), emailOTPClient()],
});
