import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/generate': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
      '/history': 'http://127.0.0.1:8000',
      '/sessions': 'http://127.0.0.1:8000'
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js'
  }
})
