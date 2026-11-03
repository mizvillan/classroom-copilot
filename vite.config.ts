import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const configuredPort = Number(process.env.PORT);
const API_PORT =
  Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 8790;

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // 5274 keeps clear of the Mizwatch dev server on 5273.
    port: 5274,
    strictPort: false,
    host: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${API_PORT}`,
        // Keep the browser's Host header so OAuth callbacks return to the
        // origin the user is actually looking at.
        changeOrigin: false,
      },
    },
  },
});
