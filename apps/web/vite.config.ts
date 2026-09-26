import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "ARK_");
  const target =
    process.env.ARK_API_TARGET ?? env.ARK_API_TARGET ?? "http://127.0.0.1:3001";
  const targetUrl = new URL(target);
  if (
    targetUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(targetUrl.hostname) ||
    targetUrl.username ||
    targetUrl.password ||
    targetUrl.search ||
    targetUrl.hash ||
    targetUrl.pathname !== "/"
  ) {
    throw new Error(
      "ARK_API_TARGET must be an HTTP loopback origin without credentials.",
    );
  }
  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      strictPort: true,
      proxy: { "/api": { target: targetUrl.origin, changeOrigin: true } },
    },
    preview: { host: "127.0.0.1", strictPort: true },
  };
});
