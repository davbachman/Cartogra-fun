import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/Cartogra-fun/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/build/three.core.js')) {
            return 'three-core'
          }

          if (id.includes('/node_modules/three/build/three.module.js')) {
            return 'three-module'
          }

          if (
            id.includes('/node_modules/@react-three/fiber/') ||
            id.includes('/node_modules/react-use-measure/') ||
            id.includes('/node_modules/its-fine/')
          ) {
            return 'react-three-fiber'
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
