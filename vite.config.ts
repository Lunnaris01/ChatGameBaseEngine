import tailwindcss from "@tailwindcss/vite";
import { readdirSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "src");

function pageEntries(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const file of readdirSync(root)) {
    if (file.endsWith(".html")) {
      entries[parse(file).name] = join(root, file);
    }
  }
  return entries;
}

export default defineConfig({
  root: "src",
  plugins: [tailwindcss()],
  server: {
    port: 8081,
    strictPort: true,
  },
  preview: {
    port: 8081,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: pageEntries(),
    },
  },
});
