import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: "electron/main.ts",
        onstart(options) {
          options.startup();
        },
        vite: { build: { outDir: "dist-electron" } },
      },
      {
        entry: "electron/preload.ts",
        onstart(options) {
          options.reload();
        },
        vite: { build: { outDir: "dist-electron" } },
      },
    ]),
  ],
  server: {
    port: 5180,
  },
  base: "./",
  build: {
    rollupOptions: {
      output: {
        // Keep the first chunk small. React and the splash are all that stand
        // between process start and a visible window; supabase-js and the
        // screens are needed later and load while the app is already talking to
        // the network. Everything is local to the installer, so this is about
        // parse/evaluate cost, not download cost — and 500KB of JS to evaluate
        // before the first frame was real time on a modest edge box.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("react") || id.includes("scheduler")) return "react";
          return "vendor";
        },
      },
    },
  },
});
