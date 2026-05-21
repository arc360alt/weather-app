import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '^/(google|config|health)': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})