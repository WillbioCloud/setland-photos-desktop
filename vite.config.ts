import { defineConfig } from 'vite';
import path from 'path';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config();

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  define: {
    'process.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL || 'https://egopjbavxkrrpxxysmck.supabase.co'),
    'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_h3F7yDPQRlFeVtTGaIP0XA_h57ZtfeA'),
    '__APP_VERSION__': JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    electron({
      main: {
        // Ponto de entrada do processo principal do Electron
        entry: 'electron/main.ts',
        vite: {
          define: {
            'process.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL || 'https://egopjbavxkrrpxxysmck.supabase.co'),
            'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_h3F7yDPQRlFeVtTGaIP0XA_h57ZtfeA'),
          },
        },
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
