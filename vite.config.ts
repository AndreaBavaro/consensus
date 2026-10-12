import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 3000,
    proxy: {
      "/api": { target: process.env.API_PROXY ?? "https://useconsensus.io", changeOrigin: true },
    },
  },
});
