import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The client bundle is built into public/client/ (gitignored) and served by
// Express under /client/. The input is the repo root's index.html: the build
// writes public/client/index.html with the hashed script and CSS tags in
// place, and Express sends that one document for every client route. With
// base "/client/" every tag it writes is absolute, so a deep path such as
// /sites/x.lychee.land loads them from the same place as /.
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
      input: "index.html",
    },
  },
});
