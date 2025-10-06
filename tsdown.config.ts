import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  exports: false, // need to manage exports so we can export the hook.mjs file
  target: "es2020",
  platform: "node",
});
