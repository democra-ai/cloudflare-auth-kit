import { createAuthClient } from "better-auth/react";

// Same-origin Worker serves Better Auth at /api/auth (its default basePath).
export const authClient = createAuthClient({
  baseURL: window.location.origin,
});
