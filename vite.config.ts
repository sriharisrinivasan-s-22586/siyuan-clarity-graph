import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    target: "es2020",
    minify: false,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "ClarityGraph",
      formats: ["cjs"],
      fileName: () => "index.js"
    },
    rollupOptions: {
      external: ["siyuan"],
      output: {
        exports: "default",
        globals: {
          siyuan: "siyuan"
        },
        assetFileNames: "index.css"
      }
    },
    outDir: "dist",
    emptyOutDir: true
  }
});
