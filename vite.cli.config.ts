import { defineConfig } from "vite";
import { builtinModules } from "node:module";

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "dist-cli",
    lib: {
      entry: "cli/tokenscope-cli.ts",
      formats: ["es"],
      fileName: () => "tokenscope-cli.mjs",
    },
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map(mod => `node:${mod}`)],
    },
  },
});
