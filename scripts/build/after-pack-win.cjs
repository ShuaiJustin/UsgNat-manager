const fs = require('node:fs/promises');
const path = require('node:path');
const rcedit = require('rcedit');

const projectRoot = path.resolve(__dirname, '..', '..');
const packageJsonPath = path.join(projectRoot, 'package.json');
const pkg = require(packageJsonPath);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function waitForWritableFile(targetPath, attempts = 12, delayMs = 1000) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const handle = await fs.open(targetPath, 'r+');
      await handle.close();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }

  throw new Error(
    `Timed out waiting for writable executable: ${targetPath}. Last error: ${lastError?.message ?? 'unknown error'}`,
  );
}

async function resolveAppExecutable(appOutDir) {
  const configuredName = pkg.build?.win?.executableName;

  if (configuredName) {
    const configuredPath = path.join(appOutDir, `${configuredName}.exe`);
    if (await fileExists(configuredPath)) {
      return configuredPath;
    }
  }

  const entries = await fs.readdir(appOutDir, { withFileTypes: true });
  const rootExecutables = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase() !== 'elevate.exe');

  if (rootExecutables.length === 1) {
    return path.join(appOutDir, rootExecutables[0]);
  }

  throw new Error(`Unable to determine packaged executable in ${appOutDir}`);
}

async function applyWindowsResources(executablePath) {
  const version = pkg.version;
  const productVersion = version.split('.').length === 3 ? `${version}.0` : version;
  const productName = pkg.build?.productName ?? pkg.name;
  const author = pkg.author ?? '';
  const iconPath = path.join(projectRoot, pkg.build?.win?.icon ?? 'resources/icons/icon.ico');
  const requestedExecutionLevel = pkg.build?.win?.requestedExecutionLevel ?? 'asInvoker';
  const internalName = pkg.build?.win?.executableName ?? path.basename(executablePath, '.exe');

  await rcedit(executablePath, {
    'version-string': {
      FileDescription: productName,
      ProductName: productName,
      LegalCopyright: `Copyright © ${new Date().getFullYear()} ${author}`.trim(),
      InternalName: internalName,
      OriginalFilename: '',
      CompanyName: author,
    },
    'file-version': version,
    'product-version': productVersion,
    'requested-execution-level': requestedExecutionLevel,
    icon: iconPath,
  });
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const executablePath = await resolveAppExecutable(context.appOutDir);
  await waitForWritableFile(executablePath);
  await sleep(3000);

  let lastError = null;

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      await applyWindowsResources(executablePath);
      console.log(`[afterPack] Patched Windows resources: ${path.basename(executablePath)}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 6) {
        console.warn(`[afterPack] rcedit attempt ${attempt} failed, retrying in 1500ms: ${error.message}`);
        await sleep(1500);
      }
    }
  }

  throw lastError;
};
