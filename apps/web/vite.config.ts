import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Pre-bundle the lazily loaded viewer libraries so the dev server never reloads mid-session.
  optimizeDeps: {
    include: [
      "three",
      "three/examples/jsm/controls/OrbitControls.js",
      "three/examples/jsm/loaders/GLTFLoader.js",
      "three/examples/jsm/loaders/OBJLoader.js",
      "three/examples/jsm/loaders/PLYLoader.js",
      "three/examples/jsm/loaders/STLLoader.js",
      "three/examples/jsm/loaders/3MFLoader.js",
      "occt-import-js",
      "dxf-parser",
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:4100" } },
  },
});
