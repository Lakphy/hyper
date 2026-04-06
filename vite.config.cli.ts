import path from 'path';

import {defineConfig} from 'vite';

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

// Vite 8 config helpers currently resolve to `any` under this repo's TS settings.
// eslint-disable-next-line @typescript-eslint/no-unsafe-call
export default defineConfig({
  build: {
    outDir: path.resolve(__dirname, 'bin'),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'cli', 'index.ts'),
      formats: ['cjs'],
      fileName: () => 'cli.js'
    },
    rollupOptions: {
      // All Node.js built-in modules and dependencies should be external
      external: [
        // Node builtins
        'child_process',
        'fs',
        'path',
        'util',
        'os',
        'url',
        // CLI dependencies - loaded at runtime
        'args',
        'chalk',
        'columnify',
        'got',
        'open',
        'ora',
        // App package.json is required at runtime
        /\.\.\/app\/package\.json/
        // CLI api module is bundled
      ],
      output: {
        format: 'cjs',
        // Preserve shebang-like behavior
        banner: '#!/usr/bin/env node'
      }
    },
    minify: isProd ? 'terser' : false,
    sourcemap: isProd ? false : true,
    target: 'node18',
    commonjsOptions: {
      transformMixedEsModules: true
    }
  },

  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json']
  },

  define: {
    'process.env.NODE_ENV': JSON.stringify(nodeEnv)
  },

  clearScreen: false
});
