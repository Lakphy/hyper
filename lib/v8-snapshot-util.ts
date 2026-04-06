if (typeof snapshotResult !== 'undefined') {
  // Use native Node.js require (not intercepted by bundler)
  // In webpack this was __non_webpack_require__, in Vite CJS output require is native
  const Module = globalThis.require('module');
  const originalLoad: (module: string, ...args: any[]) => any = Module._load;

  Module._load = function _load(module: string, ...args: unknown[]): NodeModule {
    let cachedModule = snapshotResult.customRequire.cache[module];

    if (cachedModule) return cachedModule.exports;

    if (snapshotResult.customRequire.definitions[module]) {
      cachedModule = {exports: snapshotResult.customRequire(module)};
    } else {
      cachedModule = {exports: originalLoad(module, ...args)};
    }

    snapshotResult.customRequire.cache[module] = cachedModule;
    return cachedModule.exports;
  };

  snapshotResult.setGlobals(global, process, window, document, console, global.require);
}
