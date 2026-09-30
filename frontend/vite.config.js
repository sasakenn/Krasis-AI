import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/generate': 'http://127.0.0.1:8000',
      '/course-chat': 'http://127.0.0.1:8000',
      '/ai-agents-chat': 'http://127.0.0.1:8000',
      '/ai-agents-subscription': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
      '/history': 'http://127.0.0.1:8000',
      '/sessions': 'http://127.0.0.1:8000',
      '/auth': 'http://127.0.0.1:8000',
      '/me': 'http://127.0.0.1:8000',
      '/billing': 'http://127.0.0.1:8000',
      '/tasks': 'http://127.0.0.1:8000',
      '/task-generator': 'http://127.0.0.1:8000',
      '/study-notes': 'http://127.0.0.1:8000',
      '/literature': 'http://127.0.0.1:8000',
      '/mode-history': 'http://127.0.0.1:8000',
      '/activity': 'http://127.0.0.1:8000',
      // '/admin'自体はSPAのページパス(AdminDashboard)なのでプロキシせず、
      // '/admin/'配下のAPIパスだけをバックエンドへ転送する。
      '/admin/overview': 'http://127.0.0.1:8000',
      '/admin/logins': 'http://127.0.0.1:8000',
      '/admin/prompts': 'http://127.0.0.1:8000'
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js'
  }
})
