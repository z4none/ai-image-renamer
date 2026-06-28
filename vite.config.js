import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script",
      includeAssets: ["logo-192.png", "logo-512.png", "logo-1024.png", "screenshot-light.png", "screenshot-dark.png"],
      manifest: {
        name: "AI Image Renamer",
        short_name: "Image Renamer",
        description: "Rename local image folders with Chrome built-in AI.",
        id: "/app/",
        start_url: "/app/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#eef3f8",
        theme_color: "#2563eb",
        categories: ["productivity", "photo", "utilities"],
        icons: [
          {
            src: "/logo-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/logo-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/logo-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/logo-1024.png",
            sizes: "1024x1024",
            type: "image/png",
          },
        ],
        screenshots: [
          {
            src: "/screenshot-light.png",
            sizes: "1398x987",
            type: "image/png",
            form_factor: "wide",
            label: "AI Image Renamer light interface",
          },
          {
            src: "/screenshot-dark.png",
            sizes: "1398x987",
            type: "image/png",
            form_factor: "wide",
            label: "AI Image Renamer dark interface",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,webmanifest}"],
        globIgnores: ["logo.fw.png"],
        navigateFallback: "/index.html",
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
});
