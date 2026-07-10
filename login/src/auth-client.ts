import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";

// Same-origin Worker serves Better Auth at /api/auth (its default basePath).
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [passkeyClient()],
});
