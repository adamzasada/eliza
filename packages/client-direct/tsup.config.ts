import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    outDir: "dist",
    sourcemap: true,
    clean: true,
    format: ["esm"],
    target: "node18",
    external: [
        // Node.js built-ins
        "path",
        "fs",
        "http",
        "https",
        // Native modules and their dependencies
        "@anush008/tokenizers",
        "mime-types",
        "type-is",
        "multer",
        "express",
        // Add any other problematic dependencies here
        "@reflink/reflink",
        "@node-llama-cpp",
        "agentkeepalive",
        "safe-buffer"
    ],
    platform: 'node',
    esbuildOptions(options) {
        options.mainFields = ['module', 'main'];
        options.conditions = ['import', 'module', 'require', 'default'];
    }
});
