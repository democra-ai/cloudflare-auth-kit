import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Builds the login page (./login, a Vite app around better-auth-ui) into ./public,
// next to the Studio shell files copied there by scripts/build-assets.mjs.
// No React plugin: esbuild compiles the TSX (automatic JSX runtime); wrangler's
// build.command re-runs this on change, so HMR/fast-refresh isn't needed.
export default defineConfig({
  root: "login",
  plugins: [tailwindcss()],
  build: {
    // outside the Vite root → never emptied; emptyOutDir:false silences the warning
    outDir: fileURLToPath(new URL("./public", import.meta.url)),
    emptyOutDir: false,
    rolldownOptions: {
      // the entry is login.html (default would be <root>/index.html, which is Studio's)
      input: fileURLToPath(new URL("./login/login.html", import.meta.url)),
    },
  },
  server: {
    // for standalone `vite dev` in ./login — proxy the auth API to wrangler dev
    proxy: { "/api": "http://localhost:8787", "/providers": "http://localhost:8787" },
  },
});
