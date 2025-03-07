import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: "src/js/card.js",
          dest: "src/js",
        },
        {
          src: "src/classifiers/**/*",
          dest: "classifiers",
        },
      ],
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        analyse: "analyse.html",
      },
    },
  },
});
