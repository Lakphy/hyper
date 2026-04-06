const childProcess = require('child_process');
const vm = require('vm');
const path = require('path');
const fs = require('fs');
const electronLink = require('electron-link');
const {mkdirp} = require('fs-extra');

const excludedModules = {};

const crossArchDirs = ['clang_x86_v8_arm', 'clang_x64_v8_arm64', 'win_clang_x64'];

function getTargetArch() {
  const arch = process.env.npm_config_arch;
  if (!arch) {
    throw new Error('npm_config_arch is required when generating V8 snapshots');
  }

  return arch;
}

function getV8ContextFileName(arch) {
  if (process.platform === 'darwin') {
    return `v8_context_snapshot${arch === 'arm64' ? '.arm64' : '.x86_64'}.bin`;
  }

  return 'v8_context_snapshot.bin';
}

function assertSnapshotOutputs(outputBlobPath, arch) {
  const expectedFiles = ['snapshot_blob.bin', getV8ContextFileName(arch)];
  for (const fileName of expectedFiles) {
    const filePath = path.join(outputBlobPath, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`mksnapshot did not generate expected file: ${filePath}`);
    }
  }
}

async function main() {
  const baseDirPath = path.resolve(__dirname, '..');
  const targetArch = getTargetArch();

  console.log('Creating a linked script..');
  const result = await electronLink({
    baseDirPath: baseDirPath,
    mainPath: `${__dirname}/snapshot-libs.js`,
    cachePath: `${baseDirPath}/cache`,
    // eslint-disable-next-line no-prototype-builtins
    shouldExcludeModule: (modulePath) => excludedModules.hasOwnProperty(modulePath)
  });

  const snapshotScriptPath = `${baseDirPath}/cache/snapshot-libs.js`;
  fs.writeFileSync(snapshotScriptPath, result.snapshotScript);

  // Verify if we will be able to use this in `mksnapshot`
  vm.runInNewContext(result.snapshotScript, undefined, {filename: snapshotScriptPath, displayErrors: true});

  const outputBlobPath = `${baseDirPath}/cache/${targetArch}`;
  await mkdirp(outputBlobPath);

  if (process.platform !== 'darwin') {
    const mksnapshotBinPath = `${baseDirPath}/node_modules/electron-mksnapshot/bin`;
    const matchingDirs = crossArchDirs.map((dir) => `${mksnapshotBinPath}/${dir}`).filter((dir) => fs.existsSync(dir));
    for (const dir of matchingDirs) {
      if (fs.existsSync(`${mksnapshotBinPath}/gen/v8/embedded.S`)) {
        await mkdirp(`${dir}/gen/v8`);
        fs.copyFileSync(`${mksnapshotBinPath}/gen/v8/embedded.S`, `${dir}/gen/v8/embedded.S`);
      }
    }
  }

  console.log(`Generating startup blob in "${outputBlobPath}"`);
  childProcess.execFileSync(
    path.resolve(__dirname, '..', 'node_modules', '.bin', 'mksnapshot' + (process.platform === 'win32' ? '.cmd' : '')),
    [snapshotScriptPath, '--output_dir', outputBlobPath],
    {stdio: 'inherit'}
  );

  assertSnapshotOutputs(outputBlobPath, targetArch);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
