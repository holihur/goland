import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: false,
        ws: true,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vite-preload", test: /preload-helper/ },
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "lezer", test: /node_modules[\\/]@lezer[\\/]/, priority: 20 },
            { name: "codemirror-core", test: /node_modules[\\/]@codemirror[\\/](?!lang-|legacy-modes)/ },
            { name: "codemirror-react", test: /node_modules[\\/]@uiw[\\/]/ },
            { name: "xterm", test: /node_modules[\\/]@xterm[\\/]/ },
          ],
        },
      },
    },
  },
});
