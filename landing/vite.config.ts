import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  server: {
    proxy: {
      '/api/auth': 'http://localhost:3000/auth',
      '/api/health': 'http://localhost:3000/health',
      '/auth': 'http://localhost:3000',
      '/webhook': 'http://localhost:3000',
    },
  },
})
