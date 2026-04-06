import path from 'path';

import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

// eslint-disable-next-line @typescript-eslint/no-unsafe-call
export default defineConfig({
  root: path.resolve(__dirname, 'lib/remote-ui'),

  plugins: [
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    react({jsxRuntime: 'automatic'})
  ],

  define: {
    'process.env.NODE_ENV': JSON.stringify(nodeEnv)
  },

  build: {
    outDir: path.resolve(__dirname, 'target', 'remote-ui'),
    emptyOutDir: true,
    target: 'es2022',
    minify: isProd ? 'terser' : false,
    sourcemap: isProd ? false : true
  },

  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx']
  },

  clearScreen: false
});
