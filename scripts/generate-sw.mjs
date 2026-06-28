import { generateSW } from "workbox-build";

const { count, size, warnings } = await generateSW({
  globDirectory: "dist",
  globPatterns: [
    "app/index.html",
    "assets/*.{js,css}",
    "logo-*.png",
    "screenshot-*.png",
    "manifest.webmanifest",
    "registerSW.js",
  ],
  globIgnores: ["sw.js", "workbox-*.js", "logo.fw.png"],
  swDest: "dist/sw.js",
  cleanupOutdatedCaches: true,
  navigateFallback: "/app/index.html",
  navigateFallbackAllowlist: [/^\/app(?:\/.*)?$/],
});

for (const warning of warnings) {
  console.warn(warning);
}

console.log(`Generated service worker with ${count} precached files (${size} bytes).`);
