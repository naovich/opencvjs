import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: "src/js/desktop.js",
          dest: "src/js",
        },
        {
          src: "src/js/mobile.js",
          dest: "src/js",
        },
        {
          src: "src/js/analyse.js",
          dest: "src/js",
        },
        {
          src: "src/classifiers/**/*",
          dest: "src/classifiers",
        },
      ],
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        analyse: "analyse.html",
        mobile: "mobile.html",
      },
    },
  },
});
