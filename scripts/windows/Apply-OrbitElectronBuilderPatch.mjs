import { readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'

const repoRoot = resolve(process.argv[2] || process.cwd())
const requireFromRepo = createRequire(join(repoRoot, 'package.json'))
const electronBuilderPackagePath = requireFromRepo.resolve('electron-builder/package.json')
const requireFromElectronBuilder = createRequire(electronBuilderPackagePath)
const appBuilderPackagePath = requireFromElectronBuilder.resolve('app-builder-lib/package.json')
const appBuilderPackage = JSON.parse(await readFile(appBuilderPackagePath, 'utf8'))

if (appBuilderPackage.version !== '25.1.8') {
  throw new Error(
    `Unsupported app-builder-lib ${appBuilderPackage.version}; review the Smart App Control patch before building.`
  )
}

const targetPath = join(dirname(appBuilderPackagePath), 'out', 'targets', 'nsis', 'NsisTarget.js')
const resolvedTargetPath = await realpath(targetPath)
const targetRelativePath = relative(repoRoot, resolvedTargetPath)
if (targetRelativePath.startsWith('..') || resolve(repoRoot, targetRelativePath) !== resolvedTargetPath) {
  throw new Error(`Refusing to patch app-builder-lib outside the ORBIT workspace: ${resolvedTargetPath}`)
}

const original = `        // http://forums.winamp.com/showthread.php?p=3078545
        if ((0, macosVersion_1.isMacOsCatalina)()) {`
const patched = `        // Windows Smart App Control blocks electron-builder's short-lived,
        // unsigned NSIS bootstrap. Extract the embedded uninstaller directly
        // instead of executing that bootstrap; electron-builder signs the
        // extracted uninstaller immediately afterward.
        if (isWin) {
            await nsisUtil_1.UninstallerReader.exec(installerPath, uninstallerPath);
        }
        // http://forums.winamp.com/showthread.php?p=3078545
        else if ((0, macosVersion_1.isMacOsCatalina)()) {`

const source = await readFile(resolvedTargetPath, 'utf8')
if (source.includes(patched)) {
  console.log('electron-builder Smart App Control patch already applied.')
} else {
  const occurrences = source.split(original).length - 1
  if (occurrences !== 1) {
    throw new Error('app-builder-lib does not match the reviewed 25.1.8 NSIS source.')
  }
  await writeFile(resolvedTargetPath, source.replace(original, patched), 'utf8')
  console.log('Applied electron-builder Smart App Control patch.')
}
