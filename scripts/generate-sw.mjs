import { generateSW } from "workbox-build";

const { count, size, warnings } = await generateSW({
  globDirectory: "dist",
  globPatterns: ["**/*.{js,css,html,png,svg,ico,webmanifest}"],
  globIgnores: ["sw.js", "workbox-*.js", "logo.fw.png"],
  swDest: "dist/sw.js",
  cleanupOutdatedCaches: true,
  navigateFallback: "/index.html",
});

for (const warning of warnings) {
  console.warn(warning);
}

console.log(`Generated service worker with ${count} precached files (${size} bytes).`);
