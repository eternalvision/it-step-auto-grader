import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "index.js",
      name: "StepAutoGrader",
      formats: ["iife"],
      fileName: () => "index.js",
    },
    outDir: ".vite-dist",
    emptyOutDir: true,
    minify: false,
  },
});
