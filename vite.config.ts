import { defineConfig } from "vite";
import { resolve } from "node:path";

// สองหน้า: index.html (2D) และ 3d.html (3D)
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        app3d: resolve(__dirname, "3d.html"),
      },
    },
  },
});
