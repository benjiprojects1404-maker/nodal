import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split the big libraries into their own files: they change rarely, so browsers keep them
        // cached between Nodal releases, and the page's own code downloads in parallel with them.
        manualChunks: {
          ethers: ["ethers"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
