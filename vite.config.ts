import fs from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Copies the pdf.js runtime assets (CMaps, fonts, decoders) into dist/pdfjs for builds that ship without node_modules. */
const pdfjsAssets = (): Plugin => ({
  name: "pdfjs-assets",
  apply: "build",
  closeBundle() {
    for (const sub of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
      fs.cpSync(`node_modules/pdfjs-dist/${sub}`, `dist/pdfjs/${sub}`, { recursive: true });
    }
  },
});

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 2500,
  },
});
