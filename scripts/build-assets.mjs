// Copies the Better Auth Studio shell (from node_modules) into ./public,
// next to our own login.html, so one ASSETS binding serves both.
import { cp, mkdir, access, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

// Remove stale hashed login bundles first (vite runs with emptyOutDir:false).
const publicAssets = new URL("../public/assets/", import.meta.url).pathname;
try {
  for (const f of await readdir(publicAssets)) {
    if (f.startsWith("login-")) await rm(join(publicAssets, f));
  }
} catch {
  /* no assets dir yet */
}

// Walk up from cwd to find node_modules/better-auth-studio/dist/public.
async function findStudioPublic(start) {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "node_modules", "better-auth-studio", "dist", "public");
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* keep walking */
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const src = await findStudioPublic(process.cwd());
if (!src) {
  console.warn("[build-assets] better-auth-studio/dist/public not found — run `npm install` first. (login page still works)");
  process.exit(0);
}

const dest = new URL("../public/", import.meta.url).pathname;
await mkdir(dest, { recursive: true });
for (const entry of await readdir(src)) {
  await cp(join(src, entry), join(dest, entry), { recursive: true });
}
console.log(`[build-assets] copied Studio shell from ${src} into ./public`);

// The Simplified-Chinese overlay for the Studio UI (served at /studio-i18n.js, injected
// into every Studio HTML response by the Worker).
try {
  await cp(new URL("../i18n/studio-overlay.js", import.meta.url).pathname, join(dest, "studio-i18n.js"));
  console.log("[build-assets] copied studio-i18n.js overlay into ./public");
} catch {
  console.warn("[build-assets] i18n/studio-overlay.js missing — Studio stays English-only");
}

// The Cloudflare-orange theme override for the Studio UI (served at /studio-theme.css).
try {
  await cp(new URL("../theme/studio-cloudflare.css", import.meta.url).pathname, join(dest, "studio-theme.css"));
  console.log("[build-assets] copied studio-theme.css into ./public");
} catch {
  console.warn("[build-assets] theme/studio-cloudflare.css missing — Studio keeps its stock colors");
}
