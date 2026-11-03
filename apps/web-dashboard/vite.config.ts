import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (_err, _req, res) => {
            if (res && "writeHead" in res && !(res as any).headersSent) {
              res.writeHead(502, { "Content-Type": "text/plain" });
              res.end("Backend API offline");
            }
          });
        },
      },
      "/socket.io": {
        target: "http://127.0.0.1:3000",
        ws: true,
        configure: (proxy) => {
          proxy.on("error", (_err, _req, res) => {
            if (res && "writeHead" in res && !(res as any).headersSent) {
              res.writeHead(502, { "Content-Type": "text/plain" });
              res.end("Socket gateway offline");
            }
          });
        },
      },
      "/healthz": {
        target: "http://127.0.0.1:3000",
      },
      "/readyz": {
        target: "http://127.0.0.1:3000",
      },
      "/stream/hls": {
        target: "http://127.0.0.1:8888",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/stream\/hls/, ""),
      },
      "/stream/webrtc": {
        target: "http://127.0.0.1:8889",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/stream\/webrtc/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["**/e2e/**", "**/node_modules/**"],
  },
});