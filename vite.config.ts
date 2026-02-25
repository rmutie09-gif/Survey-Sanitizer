import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite'; // <--- Add this import
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // <--- Add this plugin here
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1600,
  },
});
