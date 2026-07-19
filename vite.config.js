import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

function buildVersion(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/fin/',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.BUILD_VERSION ?? buildVersion()),
  },
  plugins: [react(), tailwindcss()],
  test: {
    exclude: ['e2e/**', 'node_modules/**'],
  },
}))
