import { defineConfig } from 'vite'
import path from "path"
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        // Ponto de entrada do processo principal do Electron
        entry: 'electron/main.ts',
      },
      preload: {
        // Arquivo de ponte de seguranca compilado como CJS para execucao direta no Electron
        input: 'electron/preload.ts',
        vite: {
          build: {
            rollupOptions: {
              output: {
                format: 'cjs',
                entryFileNames: '[name].cjs',
              },
            },
          },
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
