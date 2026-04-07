const path = require('path');
const fs = require('fs');
const asar = require('@electron/asar');

const cpSnapshot = require('./cp-snapshot.js');

const SKIP_DIRS = new Set([
  '.pnpm', '.bin', '.modules.yaml', '.ignored',
  'electron', 'electron-devtools-installer',
]);

function shouldSkip(name) {
  if (SKIP_DIRS.has(name)) return true;
  if (name.startsWith('.ignored')) return true;
  return false;
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, {recursive: true});
  for (const entry of fs.readdirSync(src, {withFileTypes: true})) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    } else if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function hasNativeContent(dir) {
  const buildDir = path.join(dir, 'build');
  const prebuildsDir = path.join(dir, 'prebuilds');
  const binDir = path.join(dir, 'bin');
  if (fs.existsSync(buildDir) || fs.existsSync(prebuildsDir)) return true;
  return findNodeFiles(dir);
}

function findNodeFiles(dir, depth = 0) {
  if (depth > 3) return false;
  try {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (entry.name.endsWith('.node') && entry.isFile()) return true;
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        if (findNodeFiles(path.join(dir, entry.name), depth + 1)) return true;
      }
    }
  } catch (_) {}
  return false;
}

function findNativeModuleDirs(nodeModulesDir) {
  const nativeDirs = [];
  if (!fs.existsSync(nodeModulesDir)) return nativeDirs;

  for (const entry of fs.readdirSync(nodeModulesDir, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;

    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(nodeModulesDir, entry.name);
      for (const sub of fs.readdirSync(scopeDir, {withFileTypes: true})) {
        if (!sub.isDirectory()) continue;
        if (hasNativeContent(path.join(scopeDir, sub.name))) {
          nativeDirs.push(`${entry.name}/${sub.name}`);
        }
      }
    } else {
      if (hasNativeContent(path.join(nodeModulesDir, entry.name))) {
        nativeDirs.push(entry.name);
      }
    }
  }
  return nativeDirs;
}

async function fixNodeModules(context) {
  const appOutDir = context.appOutDir;
  const platform = context.electronPlatformName;

  let asarPath;
  if (platform === 'darwin') {
    asarPath = path.join(appOutDir, `${context.packager.appInfo.productFilename}.app`,
      'Contents', 'Resources', 'app.asar');
  } else {
    asarPath = path.join(appOutDir, 'resources', 'app.asar');
  }

  if (!fs.existsSync(asarPath)) {
    console.log('asar not found, skipping node_modules fix:', asarPath);
    return;
  }

  const targetNodeModules = path.resolve(__dirname, '..', 'target', 'node_modules');
  if (!fs.existsSync(targetNodeModules)) {
    console.log('target/node_modules not found, skipping fix');
    return;
  }

  const unpackedPath = asarPath + '.unpacked';
  const unpackedBackup = asarPath + '.unpacked.bak';
  if (fs.existsSync(unpackedPath)) {
    console.log('Backing up existing app.asar.unpacked...');
    fs.renameSync(unpackedPath, unpackedBackup);
  }

  console.log('Fixing asar node_modules...');

  const extractDir = asarPath + '.extracted';
  try {
    asar.extractAll(asarPath, extractDir);

    const asarNodeModules = path.join(extractDir, 'node_modules');

    for (const entry of fs.readdirSync(targetNodeModules, {withFileTypes: true})) {
      if (shouldSkip(entry.name)) continue;
      if (!entry.isDirectory()) continue;

      const src = path.join(targetNodeModules, entry.name);
      const dest = path.join(asarNodeModules, entry.name);

      if (entry.name.startsWith('@')) {
        fs.mkdirSync(dest, {recursive: true});
        for (const sub of fs.readdirSync(src, {withFileTypes: true})) {
          if (!sub.isDirectory()) continue;
          const subSrc = path.join(src, sub.name);
          const subDest = path.join(dest, sub.name);
          if (!fs.existsSync(subDest)) {
            copyDirRecursive(subSrc, subDest);
            console.log(`  + ${entry.name}/${sub.name}`);
          }
        }
      } else if (!fs.existsSync(dest)) {
        copyDirRecursive(src, dest);
        console.log(`  + ${entry.name}`);
      }
    }

    // Identify native modules - these need to be fully unpacked from asar
    const nativeDirs = findNativeModuleDirs(asarNodeModules);
    console.log('Native modules to unpack:', nativeDirs);

    fs.unlinkSync(asarPath);

    // Use unpackDir to unpack entire native module directories
    // This ensures spawn-helper and other non-.node executables are accessible
    const unpackDirPattern = nativeDirs.length > 0
      ? `{${nativeDirs.map(d => `node_modules/${d}`).join(',')}}`
      : undefined;

    console.log('UnpackDir pattern:', unpackDirPattern);

    await asar.createPackageWithOptions(extractDir, asarPath, {
      unpackDir: unpackDirPattern,
    });

    if (fs.existsSync(unpackedPath)) {
      console.log('app.asar.unpacked created successfully.');
      if (fs.existsSync(unpackedBackup)) {
        mergeDir(unpackedBackup, unpackedPath);
        fs.rmSync(unpackedBackup, {recursive: true, force: true});
      }
    } else {
      console.warn('WARNING: app.asar.unpacked was NOT created!');
      console.log('Creating app.asar.unpacked manually...');
      fs.mkdirSync(unpackedPath, {recursive: true});

      for (const modName of nativeDirs) {
        const srcMod = path.join(extractDir, 'node_modules', modName);
        const destMod = path.join(unpackedPath, 'node_modules', modName);
        if (fs.existsSync(srcMod)) {
          copyDirRecursive(srcMod, destMod);
          console.log(`  unpacked: ${modName}`);
        }
      }

      if (fs.existsSync(unpackedBackup)) {
        mergeDir(unpackedBackup, unpackedPath);
        fs.rmSync(unpackedBackup, {recursive: true, force: true});
      }
    }

    // Verify spawn-helper exists for node-pty
    const spawnHelper = path.join(unpackedPath, 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper');
    if (fs.existsSync(spawnHelper)) {
      console.log('spawn-helper verified at:', spawnHelper);
    } else {
      console.warn('WARNING: spawn-helper NOT found in unpacked!');
    }

    console.log('Asar node_modules fixed successfully.');
  } finally {
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, {recursive: true, force: true});
    }
    if (fs.existsSync(unpackedBackup)) {
      fs.rmSync(unpackedBackup, {recursive: true, force: true});
    }
  }
}

function mergeDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, {recursive: true});
  for (const entry of fs.readdirSync(src, {withFileTypes: true})) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      mergeDir(s, d);
    } else if (!fs.existsSync(d)) {
      fs.copyFileSync(s, d);
    }
  }
}

exports.default = async (context) => {
  await cpSnapshot.default(context);
  await fixNodeModules(context);
};
