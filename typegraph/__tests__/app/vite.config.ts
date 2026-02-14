import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { falkordbPlugin } from './src/server/vite-plugin-falkordb'

export default defineConfig({
  plugins: [tailwindcss(), react(), falkordbPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@authz': resolve(__dirname, '../integration/authz-v2'),
    },
    dedupe: ['react', 'react-dom'],
  },
})
