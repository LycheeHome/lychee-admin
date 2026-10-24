import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The client bundle is built into public/client/ (gitignored) and served by
// Express under /client/. The manifest is how the server finds the hashed
// entry file; see the spec's section 3.
export default defineConfig({
  root: __dirname,
  base: "/client/",
  // Vite's default publicDir is ./public, which would copy style.css into
  // public/client/. Express already serves public/ itself.
  publicDir: false,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "public/client",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: "src/client/main.tsx",
    },
  },
});
