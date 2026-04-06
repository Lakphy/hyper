import path from 'path';

import babel from '@rolldown/plugin-babel';
import react from '@vitejs/plugin-react';
import {codeInspectorPlugin} from 'code-inspector-plugin';
import {defineConfig} from 'vite';
import {viteStaticCopy} from 'vite-plugin-static-copy';

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const rendererRuntimeNodeModulesPath = isProd ? '../node_modules' : '../../node_modules';

// These modules must resolve from `target/node_modules` at runtime so Electron
// uses the same dependency instances the main process copied into the app.
const rendererExternalPaths: Record<string, string> = {
  electron: 'electron',
  'color-convert': `${rendererRuntimeNodeModulesPath}/color-convert/index.js`,
  'color-string': `${rendererRuntimeNodeModulesPath}/color-string/index.js`,
  columnify: `${rendererRuntimeNodeModulesPath}/columnify/columnify.js`,
  lodash: `${rendererRuntimeNodeModulesPath}/lodash/lodash.js`,
  ms: `${rendererRuntimeNodeModulesPath}/ms/index.js`,
  'normalize-url': `${rendererRuntimeNodeModulesPath}/normalize-url/index.js`,
  'parse-url': `${rendererRuntimeNodeModulesPath}/parse-url/dist/index.js`,
  'php-escape-shell': `${rendererRuntimeNodeModulesPath}/php-escape-shell/php-escape-shell.js`,
  plist: `${rendererRuntimeNodeModulesPath}/plist/index.js`,
  react: `${rendererRuntimeNodeModulesPath}/react/index.js`,
  'react/jsx-runtime': `${rendererRuntimeNodeModulesPath}/react/jsx-runtime.js`,
  'react/jsx-dev-runtime': `${rendererRuntimeNodeModulesPath}/react/jsx-dev-runtime.js`,
  'react-dom': `${rendererRuntimeNodeModulesPath}/react-dom/index.js`,
  'react-dom/client': `${rendererRuntimeNodeModulesPath}/react-dom/client.js`,
  'react-redux': `${rendererRuntimeNodeModulesPath}/react-redux/lib/index.js`,
  'redux-thunk': `${rendererRuntimeNodeModulesPath}/redux-thunk/lib/index.js`,
  redux: `${rendererRuntimeNodeModulesPath}/redux/lib/redux.js`,
  reselect: `${rendererRuntimeNodeModulesPath}/reselect/lib/index.js`,
  'seamless-immutable': `${rendererRuntimeNodeModulesPath}/seamless-immutable/src/seamless-immutable.js`,
  stylis: `${rendererRuntimeNodeModulesPath}/stylis/stylis.js`,
  '@xterm/addon-unicode11': `${rendererRuntimeNodeModulesPath}/@xterm/addon-unicode11/lib/addon-unicode11.js`,
  args: `${rendererRuntimeNodeModulesPath}/args/lib/index.js`,
  mousetrap: `${rendererRuntimeNodeModulesPath}/mousetrap/mousetrap.js`,
  open: `${rendererRuntimeNodeModulesPath}/open/index.js`,
  '@xterm/addon-fit': `${rendererRuntimeNodeModulesPath}/@xterm/addon-fit/lib/addon-fit.js`,
  '@xterm/addon-image': `${rendererRuntimeNodeModulesPath}/@xterm/addon-image/lib/addon-image.js`,
  '@xterm/addon-search': `${rendererRuntimeNodeModulesPath}/@xterm/addon-search/lib/addon-search.js`,
  '@xterm/addon-web-links': `${rendererRuntimeNodeModulesPath}/@xterm/addon-web-links/lib/addon-web-links.js`,
  '@xterm/addon-webgl': `${rendererRuntimeNodeModulesPath}/@xterm/addon-webgl/lib/addon-webgl.js`,
  '@xterm/xterm': `${rendererRuntimeNodeModulesPath}/@xterm/xterm/lib/xterm.js`
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
