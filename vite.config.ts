import { defineConfig } from "vite";
import { resolve } from "node:path";

// หน้า: index.html (2D), 3d.html (3D), manual.html (คู่มือ)
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        app3d: resolve(__dirname, "3d.html"),
        manual: resolve(__dirname, "manual.html"),
      },
    },
  },
});
