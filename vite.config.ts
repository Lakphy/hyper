import path from 'path';

import babel from '@rolldown/plugin-babel';
import react from '@vitejs/plugin-react';
import {codeInspectorPlugin} from 'code-inspector-plugin';
import {defineConfig} from 'vite';
import {viteStaticCopy} from 'vite-plugin-static-copy';

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

// These modules must resolve from `target/node_modules` at runtime so Electron
// uses the same dependency instances the main process copied into the app.
const rendererExternalPaths: Record<string, string> = {
  electron: 'electron',
  'color-convert': '../node_modules/color-convert/index.js',
  'color-string': '../node_modules/color-string/index.js',
  columnify: '../node_modules/columnify/columnify.js',
  lodash: '../node_modules/lodash/lodash.js',
  ms: '../node_modules/ms/index.js',
  'normalize-url': '../node_modules/normalize-url/index.js',
  'parse-url': '../node_modules/parse-url/dist/index.js',
  'php-escape-shell': '../node_modules/php-escape-shell/php-escape-shell.js',
  plist: '../node_modules/plist/index.js',
  react: '../node_modules/react/index.js',
  'react/jsx-runtime': '../node_modules/react/jsx-runtime.js',
  'react/jsx-dev-runtime': '../node_modules/react/jsx-dev-runtime.js',
  'react-dom': '../node_modules/react-dom/index.js',
  'react-dom/client': '../node_modules/react-dom/client.js',
  'react-redux': '../node_modules/react-redux/lib/index.js',
  'redux-thunk': '../node_modules/redux-thunk/lib/index.js',
  redux: '../node_modules/redux/lib/redux.js',
  reselect: '../node_modules/reselect/lib/index.js',
  'seamless-immutable': '../node_modules/seamless-immutable/src/seamless-immutable.js',
  stylis: '../node_modules/stylis/stylis.js',
  '@xterm/addon-unicode11': '../node_modules/@xterm/addon-unicode11/lib/addon-unicode11.js',
  args: '../node_modules/args/lib/index.js',
  mousetrap: '../node_modules/mousetrap/mousetrap.js',
  open: '../node_modules/open/index.js',
  '@xterm/addon-fit': '../node_modules/@xterm/addon-fit/lib/addon-fit.js',
  '@xterm/addon-image': '../node_modules/@xterm/addon-image/lib/addon-image.js',
  '@xterm/addon-search': '../node_modules/@xterm/addon-search/lib/addon-search.js',
  '@xterm/addon-web-links': '../node_modules/@xterm/addon-web-links/lib/addon-web-links.js',
  '@xterm/addon-webgl': '../node_modules/@xterm/addon-webgl/lib/addon-webgl.js',
  '@xterm/xterm': '../node_modules/@xterm/xterm/lib/xterm.js'
};

// Node.js builtins used in Electron renderer (nodeIntegration: true)
const nodeBuiltins = [
  'module',
  'path',
  'child_process',
  'fs',
  'os',
  'util',
  'events',
  'stream',
  'buffer',
  'url',
  'assert',
  'crypto',
  'net',
  'tls',
  'http',
  'https',
  'zlib',
  'querystring',
  'string_decoder'
];

const nodeBuiltinSet = new Set(nodeBuiltins);

function rendererExternalPlugin() {
  return {
    name: 'hyper-renderer-externals',
    enforce: 'pre' as const,
    resolveId(source: string) {
      const mappedPath = rendererExternalPaths[source];
      if (mappedPath) {
        return {id: mappedPath, external: true};
      }

      if (nodeBuiltinSet.has(source)) {
        return {id: source, external: true};
      }

      return null;
    }
  };
}

// Vite 8 config helpers/plugins currently resolve to `any` under this repo's TS settings.
// eslint-disable-next-line @typescript-eslint/no-unsafe-call
export default defineConfig({
  plugins: [
    rendererExternalPlugin(),
    ...(!isProd
      ? [
          codeInspectorPlugin({
            bundler: 'vite',
            dev: true,
            // Terminal apps often compete with global hotkeys.
            showSwitch: true,
            hideConsole: false,
            ...(process.platform === 'darwin' ? ({launchType: 'open', showSwitch: true} as const) : {})
          })
        ]
      : []),
    // React plugin for JSX transform (uses Oxc, no Babel needed for basic React)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    react({
      jsxRuntime: 'classic'
    }),
    // Babel plugin for styled-jsx support (must run after React plugin)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    babel({
      plugins: [
        [
          'styled-jsx/babel',
          {
            vendorPrefixes: false
          }
        ]
      ],
      include: /\.(jsx|tsx|js|ts)$/,
      exclude: /node_modules/
    }),
    viteStaticCopy({
      targets: [
        {
          src: 'assets/*',
          dest: 'assets'
        }
      ]
    })
  ],

  define: {
    'process.env.NODE_ENV': JSON.stringify(nodeEnv)
  },

  build: {
    outDir: path.resolve(__dirname, 'target', 'renderer'),
    emptyOutDir: false,
    // Produce a single bundle file compatible with Electron's CJS environment
    lib: {
      entry: path.resolve(__dirname, 'lib', 'index.tsx'),
      formats: ['cjs'],
      fileName: () => 'bundle.js',
      cssFileName: 'hyper'
    },
    rollupOptions: {
      output: {
        // Keep the format as CJS for Electron
        format: 'cjs',
        // Asset file names
        assetFileNames: 'assets/[name][extname]'
      }
    },
    // Use terser for production (matching original config), esbuild for dev
    minify: isProd ? 'terser' : false,
    sourcemap: isProd ? 'hidden' : true,
    // Don't use CSS code splitting - inject it into JS
    cssCodeSplit: false,
    target: 'chrome134', // Electron uses Chromium
    // Ensure CommonJS compatibility
    commonjsOptions: {
      transformMixedEsModules: true
    }
  },

  // Disable clearing the screen so we can see all logs
  clearScreen: false,

  // Resolve options matching the original webpack resolve
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.d.ts']
  }
});
