/**
 * Which application is this login page for?
 *
 * Tenants are mounted under a path prefix: `/<slug>/auth/sign-in`. The control-plane login
 * lives at the root: `/auth/sign-in`. So the slug is the first path segment whenever the
 * SECOND segment is one of our page roots — never guess from a single segment.
 */
const PAGE_ROOTS = new Set(["auth", "login"]);

export const APP_SLUG = (() => {
  const seg = window.location.pathname.split("/").filter(Boolean);
  return seg.length >= 2 && PAGE_ROOTS.has(seg[1]) ? seg[0] : "";
})();

/** "" for the control plane, "/citetrack" for a tenant. */
export const APP_BASE = APP_SLUG ? `/${APP_SLUG}` : "";

/** The path better-auth-ui should use to pick a view, with any app prefix removed. */
export function viewPathname(): string {
  const p = window.location.pathname.slice(APP_BASE.length) || "/";
  return p === "/login" ? "/auth/sign-in" : p;
}
