import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Audit 6, L-10: no production source maps. The repo is public, but the
  // deployed bundle should not ship the maps alongside it.
  build: { target: "es2020", sourcemap: false },
});
