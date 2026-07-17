import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";

export default defineConfig({
  plugins: [
    react(),
    electron([
      { entry: "electron/main.ts", vite: { build: { outDir: "dist-electron" } } },
      { entry: "electron/preload.ts", vite: { build: { outDir: "dist-electron" } } },
    ]),
  ],
  server: {
    port: 5180,
  },
  base: "./",
});
