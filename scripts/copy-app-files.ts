/**
 * This script replaces the old `webpack --config-name hyper-app` build step.
 * The hyper-app webpack config didn't actually compile anything - it only
 * used copy-webpack-plugin to copy static files from app/ to target/.
 */
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const watchMode = process.argv.includes('--watch');

type GlobPattern = {from: string; toDir: string};
type DirPattern = {fromDir: string; toDir: string};
type CopyPattern = GlobPattern | DirPattern;

const copyPatterns: CopyPattern[] = [
  // HTML files
  {from: 'app/*.html', toDir: 'target'},
  // JSON files (package.json, etc.)
  {from: 'app/*.json', toDir: 'target'},
  // Config JSON files
  {from: 'app/config/*.json', toDir: 'target/config'},
  // Keymaps JSON files
  {from: 'app/keymaps/*.json', toDir: 'target/keymaps'},
  // Static directory
  {fromDir: 'app/static', toDir: 'target/static'},
  // Patches directory
  {fromDir: 'app/patches', toDir: 'target/patches'}
];

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true});
  }
}

function copyDirRecursive(src: string, dest: string) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, {withFileTypes: true});
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function globCopy(pattern: string, toDir: string) {
  const dir = path.dirname(pattern);
  const ext = path.extname(pattern);
  const srcDir = path.resolve(root, dir);
  const destDir = path.resolve(root, toDir);
  ensureDir(destDir);

  if (!fs.existsSync(srcDir)) {
    console.warn(`  ⚠ Source dir not found: ${srcDir}`);
    return;
  }

  const files = fs.readdirSync(srcDir).filter((f) => {
    if (ext === '.*') return true;
    return f.endsWith(ext);
  });

  for (const file of files) {
    // Skip node_modules
    if (file === 'node_modules') continue;
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(destDir, file);
    if (fs.statSync(srcPath).isFile()) {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  ✓ ${path.relative(root, srcPath)} → ${path.relative(root, destPath)}`);
    }
  }
}

function copyAll() {
  console.log('Copying app files to target/...');

  for (const pattern of copyPatterns) {
    if ('fromDir' in pattern && pattern.fromDir) {
      const src = path.resolve(root, pattern.fromDir);
      const dest = path.resolve(root, pattern.toDir);
      if (fs.existsSync(src)) {
        copyDirRecursive(src, dest);
        console.log(`  ✓ ${pattern.fromDir}/ -> ${pattern.toDir}/`);
      } else {
        console.warn(`  ! Source dir not found: ${pattern.fromDir}`);
      }
    } else if ('from' in pattern) {
      globCopy(pattern.from, pattern.toDir);
    }
  }

  console.log('Done!');
}

function collectDirs(dir: string, dirs = new Set<string>()) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return dirs;
  }

  dirs.add(dir);

  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      collectDirs(path.join(dir, entry.name), dirs);
    }
  }

  return dirs;
}

copyAll();

if (watchMode) {
  console.log('Watching app/ for changes...');

  const watchers = new Map<string, fs.FSWatcher>();
  let pendingCopy: NodeJS.Timeout | undefined;
  const scheduleCopy = () => {
    if (pendingCopy) {
      clearTimeout(pendingCopy);
    }

    pendingCopy = setTimeout(() => {
      console.log('\nChange detected, syncing app files...');
      syncWatchers();
      copyAll();
    }, 100);
  };

  const syncWatchers = () => {
    const nextDirs = collectDirs(path.resolve(root, 'app'));

    for (const [dir, watcher] of watchers) {
      if (!nextDirs.has(dir)) {
        watcher.close();
        watchers.delete(dir);
      }
    }

    for (const dir of nextDirs) {
      if (!watchers.has(dir)) {
        watchers.set(dir, fs.watch(dir, scheduleCopy));
      }
    }
  };

  syncWatchers();
}
