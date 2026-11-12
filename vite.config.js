import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Two pages: index.html (authenticated app) and portal.html (portal do cidadão, a small separate
// entry that never loads the authenticated bundle). server/index.js serves dist/portal.html on
// /portal and /portal/* (see server/routes/portal.js).
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // Key "index" keeps the entry chunk name (assets/index-*.js) the app and its tests already use.
        index: resolve(import.meta.dirname, "index.html"),
        portal: resolve(import.meta.dirname, "portal.html"),
      },
    },
  },
});
