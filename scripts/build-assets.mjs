// Copies the Better Auth Studio shell (from node_modules) into ./public,
// next to our own login.html, so one ASSETS binding serves both.
import { cp, mkdir, access, readdir } from "node:fs/promises";
import { join } from "node:path";

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
