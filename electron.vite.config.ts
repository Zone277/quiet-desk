import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          widget: resolve(__dirname, 'src/renderer/widget.html'),
          capture: resolve(__dirname, 'src/renderer/capture.html'),
          library: resolve(__dirname, 'src/renderer/library.html')
        }
      }
    }
  }
})
