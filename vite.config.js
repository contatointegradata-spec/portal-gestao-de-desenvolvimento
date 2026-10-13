import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@codemirror") || id.includes("node_modules/codemirror") || id.includes("node_modules/@lezer")) return "editor";
          if (id.includes("node_modules/vue") || id.includes("node_modules/@vue")) return "vue";
          return undefined;
        }
      }
    }
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5174",
        changeOrigin: true,
        secure: false
      }
    }
  }
});
