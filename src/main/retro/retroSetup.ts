import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { app, net, shell } from 'electron'
import { path7za } from '7zip-bin'
import type {
  DetectedRetroEmulator,
  RetroEmulatorDownloadResult,
  RetroEmulatorInstallPhase,
  RetroEmulatorInstallProgress,
  RetroLibraryStatus,
  RetroSystemDirectoryResult,
  RetroSystemId
} from '@shared/ipc'
import {
  recommendedRetroEmulatorDownload,
  retroEmulatorDownloadsForSystem,
  retroSystemById
} from '@shared/retroSystems'
import { settingsStore } from '../settingsStore'
import {
  managedEmulatorDirectory,
  managedRomRootDirectory,
  managedRomSystemDirectory
} from './retroManagedPaths'
import { detectRetroEmulatorStatuses, retroLibraryService } from './retroLibrary'
import {
  RETRO_EMULATOR_EXECUTABLES,
  RETRO_EMULATOR_PROVISIONERS,
  decideRetroProvisioning,
  selectGithubReleaseAsset,
  validateArchiveEntryPath,
  validatedRetroDownloadUrl,
  type DolphinProvisioner,
  type GithubReleaseProvisioner,
  type Project64Provisioner,
  type RetroArchProvisioner,
  type RetroEmulatorProvisioner
} from './retroProvisionPolicy'

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 3 * 1024 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 100_000
const MAX_API_BYTES = 4 * 1024 * 1024
const DOWNLOAD_PROGRESS_INTERVAL_MS = 180

interface ResolvedPackage {
  url: string
  fileName: string
  expectedBytes?: number
  sha256?: string
}

interface GithubReleasePayload {
  assets?: unknown
}

export interface RetroSetupInstallResult {
  systemId: RetroSystemId
  emulatorId: string
  emulatorName: string
  directoryPath: string
  emulatorDirectoryPath: string
  alreadyInstalled: boolean
  emulatorInstalled: boolean
  coreInstalled: boolean
  firmwareMayBeRequired: boolean
  status: RetroLibraryStatus
}

type InstallProgress = (progress: RetroEmulatorInstallProgress) => void

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function trustedDownloadPageUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Invalid emulator download page')
  }
  return url.toString()
}

function safeArchiveFileName(value: string): string {
  const fileName = basename(value)
  if (
    fileName !== value ||
    fileName.length > 180 ||
    !/^[a-z\d][a-z\d ._()+-]*\.(?:7z|exe|zip)$/iu.test(fileName)
  ) {
    throw new Error('Invalid emulator package name')
  }
  return fileName
}

function resolvedSevenZipPath(): string {
  const unpacked = app.isPackaged ? path7za.replace('app.asar', 'app.asar.unpacked') : path7za
  return resolve(unpacked)
}

function executeFile(
  executable: string,
  args: readonly string[],
  timeout = 2 * 60 * 1_000,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolveValue, reject) => {
    execFile(
      executable,
      [...args],
      {
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout,
        signal
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || stdout.trim() || 'Emulator package operation failed'))
          return
        }
        resolveValue(stdout)
      }
    )
  })
}

async function fetchTrusted(urlValue: string, init?: RequestInit): Promise<Response> {
  const url = validatedRetroDownloadUrl(urlValue)
  const response = await net.fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `ORBIT/${app.getVersion()}`,
      ...(init?.headers ?? {})
    }
  })
  validatedRetroDownloadUrl(response.url || url)
  return response
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetchTrusted(url, { signal })
  if (!response.ok) throw new Error(`Official release metadata returned HTTP ${response.status}`)
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_API_BYTES) {
    throw new Error('Official release metadata is unexpectedly large')
  }
  return JSON.parse(text) as T
}

function githubApiUrl(repository: string, suffix: string): string {
  if (!/^[a-z\d_.-]+\/[a-z\d_.-]+$/iu.test(repository)) {
    throw new Error('Invalid emulator repository')
  }
  return validatedRetroDownloadUrl(`https://api.github.com/repos/${repository}/${suffix}`)
}

function normalizedDigest(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = value.match(/^sha256:([a-f\d]{64})$/iu)
  return match?.[1]?.toLocaleLowerCase('en-US')
}

async function resolveGithubRelease(
  provisioner: GithubReleaseProvisioner,
  signal: AbortSignal
): Promise<ResolvedPackage> {
  const payload = await fetchJson<GithubReleasePayload>(
    githubApiUrl(provisioner.repository, 'releases/latest'),
    signal
  )
  if (!Array.isArray(payload.assets)) throw new Error('Official release has no package list')
  const assets = payload.assets.flatMap((candidate) => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return []
    const asset = candidate as Record<string, unknown>
    if (typeof asset.name !== 'string') return []
    return [
      {
        name: asset.name,
        browser_download_url:
          typeof asset.browser_download_url === 'string' ? asset.browser_download_url : undefined,
        size: typeof asset.size === 'number' ? asset.size : undefined,
        digest: typeof asset.digest === 'string' ? asset.digest : undefined
      }
    ]
  })
  const asset = selectGithubReleaseAsset(provisioner, assets)
  if (!asset.browser_download_url) throw new Error('Official release package has no download URL')
  if (asset.size !== undefined && (!Number.isSafeInteger(asset.size) || asset.size <= 0)) {
    throw new Error('Official release package has an invalid size')
  }
  if ((asset.size ?? 0) > MAX_DOWNLOAD_BYTES) throw new Error('Emulator package is too large')
  return {
    url: validatedRetroDownloadUrl(asset.browser_download_url),
    fileName: safeArchiveFileName(asset.name),
    expectedBytes: asset.size,
    sha256: normalizedDigest(asset.digest)
  }
}

function resolveRetroArchPackage(provisioner: RetroArchProvisioner): ResolvedPackage {
  const version = provisioner.version
  return {
    url: validatedRetroDownloadUrl(
      `https://buildbot.libretro.com/stable/${version}/windows/x86_64/RetroArch.7z`
    ),
    fileName: `RetroArch-${version}.7z`,
    sha256: provisioner.sha256
  }
}

function resolveDolphinPackage(provisioner: DolphinProvisioner): ResolvedPackage {
  const version = provisioner.version
  return {
    url: validatedRetroDownloadUrl(
      `https://dl.dolphin-emu.org/releases/${version}/dolphin-${version}-x64.7z`
    ),
    fileName: `dolphin-${version}-x64.7z`,
    sha256: provisioner.sha256
  }
}

function resolveProject64Package(provisioner: Project64Provisioner): ResolvedPackage {
  const fileVersion = provisioner.version.replace(/\./gu, '-')
  return {
    url: validatedRetroDownloadUrl(`https://www.pj64-emu.com/file/project64-${fileVersion}/`),
    fileName: `project64-${fileVersion}.zip`,
    sha256: provisioner.sha256
  }
}

async function resolvePackage(
  provisioner: RetroEmulatorProvisioner,
  signal: AbortSignal
): Promise<ResolvedPackage> {
  if (provisioner.kind === 'github-release') return resolveGithubRelease(provisioner, signal)
  if (provisioner.kind === 'retroarch-stable') {
    return resolveRetroArchPackage(provisioner)
  }
  if (provisioner.kind === 'dolphin-stable') {
    return resolveDolphinPackage(provisioner)
  }
  return resolveProject64Package(provisioner)
}

async function writeResponseToFile(
  response: Response,
  destination: string,
  expectedBytes: number | undefined,
  phase: RetroEmulatorInstallPhase,
  report: (
    phase: RetroEmulatorInstallPhase,
    receivedBytes?: number,
    totalBytes?: number
  ) => void
): Promise<number> {
  if (!response.ok) throw new Error(`Emulator download returned HTTP ${response.status}`)
  const headerBytes = Number(response.headers.get('content-length'))
  const totalBytes =
    Number.isSafeInteger(headerBytes) && headerBytes > 0 ? headerBytes : expectedBytes
  if ((totalBytes ?? 0) > MAX_DOWNLOAD_BYTES) throw new Error('Emulator package is too large')
  if (!response.body) throw new Error('Emulator download returned no data')

  const handle = await open(destination, 'wx')
  const reader = response.body.getReader()
  let receivedBytes = 0
  let lastProgressAt = 0
  try {
    report(phase, 0, totalBytes)
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      receivedBytes += chunk.value.byteLength
      if (receivedBytes > MAX_DOWNLOAD_BYTES) throw new Error('Emulator package is too large')
      await handle.write(Buffer.from(chunk.value))
      const now = Date.now()
      if (now - lastProgressAt >= DOWNLOAD_PROGRESS_INTERVAL_MS) {
        report(phase, receivedBytes, totalBytes)
        lastProgressAt = now
      }
    }
  } finally {
    await handle.close()
  }
  if (expectedBytes !== undefined && receivedBytes !== expectedBytes) {
    throw new Error('Emulator package download is incomplete')
  }
  report(phase, receivedBytes, totalBytes ?? receivedBytes)
  return receivedBytes
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function downloadPackage(
  resolvedPackage: ResolvedPackage,
  destination: string,
  report: (
    phase: RetroEmulatorInstallPhase,
    receivedBytes?: number,
    totalBytes?: number
  ) => void,
  signal: AbortSignal,
  phase: RetroEmulatorInstallPhase = 'downloading'
): Promise<void> {
  const response = await fetchTrusted(resolvedPackage.url, {
    headers: { Accept: 'application/octet-stream' },
    signal
  })
  await writeResponseToFile(
    response,
    destination,
    resolvedPackage.expectedBytes,
    phase,
    report
  )
  if (resolvedPackage.sha256) {
    const actual = await sha256File(destination)
    if (actual !== resolvedPackage.sha256) throw new Error('Emulator package checksum failed')
  }
}

async function validateArchive(archivePath: string, signal: AbortSignal): Promise<void> {
  const output = await executeFile(resolvedSevenZipPath(), ['l', '-slt', archivePath], undefined, signal)
  const lines = output.split(/\r?\n/gu)
  let insideEntries = false
  let entries = 0
  let expandedBytes = 0
  for (const line of lines) {
    if (/^-{10,}$/u.test(line.trim())) {
      insideEntries = true
      continue
    }
    if (!insideEntries) continue
    const pathMatch = line.match(/^Path = (.+)$/u)
    if (pathMatch) {
      validateArchiveEntryPath(pathMatch[1])
      entries += 1
      if (entries > MAX_ARCHIVE_ENTRIES) throw new Error('Emulator package has too many files')
      continue
    }
    const sizeMatch = line.match(/^Size = (\d+)$/u)
    if (sizeMatch) {
      expandedBytes += Number(sizeMatch[1])
      if (!Number.isSafeInteger(expandedBytes) || expandedBytes > MAX_UNCOMPRESSED_BYTES) {
        throw new Error('Emulator package expands beyond the safety limit')
      }
    }
  }
  if (entries === 0) throw new Error('Emulator package is empty')
}

async function extractArchive(
  archivePath: string,
  destination: string,
  signal: AbortSignal
): Promise<void> {
  await mkdir(destination, { recursive: true })
  await executeFile(
    resolvedSevenZipPath(),
    ['x', '-y', '-aoa', `-o${destination}`, archivePath],
    5 * 60 * 1_000,
    signal
  )
  await validateExtractedTree(destination)
}

async function validateExtractedTree(root: string): Promise<void> {
  const resolvedRoot = `${await realpath(root)}${sep}`.toLocaleLowerCase('en-US')
  const queue: string[] = [root]
  let visited = 0
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      visited += 1
      if (visited > MAX_ARCHIVE_ENTRIES) throw new Error('Emulator package has too many files')
      if (entry.isSymbolicLink()) throw new Error('Emulator package contains an unsafe link')
      const path = join(current, entry.name)
      const resolvedPath = (await realpath(path)).toLocaleLowerCase('en-US')
      if (resolvedPath !== resolvedRoot.slice(0, -1) && !resolvedPath.startsWith(resolvedRoot)) {
        throw new Error('Emulator package escaped its installation directory')
      }
      if (entry.isDirectory()) queue.push(path)
    }
  }
}

async function nestedFile(
  root: string,
  fileNames: readonly string[],
  signal?: AbortSignal
): Promise<string | undefined> {
  const wanted = new Set(fileNames.map((name) => name.toLocaleLowerCase('en-US')))
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]
  let visited = 0
  while (queue.length > 0 && visited < MAX_ARCHIVE_ENTRIES) {
    signal?.throwIfAborted()
    const current = queue.shift()
    if (!current) break
    const entries = await readdir(current.path, { withFileTypes: true })
    for (const entry of entries) {
      visited += 1
      const path = join(current.path, entry.name)
      if (entry.isFile() && wanted.has(entry.name.toLocaleLowerCase('en-US'))) return path
      if (entry.isDirectory() && current.depth < 8) queue.push({ path, depth: current.depth + 1 })
    }
  }
  return undefined
}

async function mergeDirectory(
  source: string,
  destination: string,
  signal: AbortSignal
): Promise<void> {
  await mkdir(destination, { recursive: true })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    signal.throwIfAborted()
    await cp(join(source, entry.name), join(destination, entry.name), {
      recursive: true,
      force: true,
      errorOnExist: false
    })
  }
}

async function configurePortableMode(emulatorId: string, executablePath: string): Promise<void> {
  const executableDirectory = dirname(executablePath)
  if (emulatorId === 'duckstation' || emulatorId === 'dolphin') {
    await writeFile(join(executableDirectory, 'portable.txt'), '', { flag: 'a' })
  }
  if (emulatorId === 'cemu') await mkdir(join(executableDirectory, 'portable'), { recursive: true })
}

async function installEmulatorArchive(
  emulatorId: string,
  archivePath: string,
  extractedDirectory: string,
  targetDirectory: string,
  signal: AbortSignal
): Promise<void> {
  const executableNames = RETRO_EMULATOR_EXECUTABLES[emulatorId]
  if (!executableNames) throw new Error('Emulator installation is not supported')
  await validateArchive(archivePath, signal)
  await extractArchive(archivePath, extractedDirectory, signal)
  if (!(await nestedFile(extractedDirectory, executableNames, signal))) {
    throw new Error('Official package does not contain the expected emulator executable')
  }
  const packageRoot = join(targetDirectory, 'packages')
  await mkdir(packageRoot, { recursive: true })
  const stagingDirectory = join(packageRoot, `.orbit-installing-${randomUUID()}`)
  const packageName = basename(archivePath, extname(archivePath)).replace(/[^a-z\d._-]+/giu, '-')
  const installedDirectory = join(packageRoot, `${packageName}-${Date.now()}`)
  await mkdir(stagingDirectory, { recursive: true })
  try {
    await mergeDirectory(extractedDirectory, stagingDirectory, signal)
    const stagedExecutable = await nestedFile(stagingDirectory, executableNames, signal)
    if (!stagedExecutable) throw new Error('Emulator executable was not staged')
    await configurePortableMode(emulatorId, stagedExecutable)
    signal.throwIfAborted()
    await rename(stagingDirectory, installedDirectory)
  } catch (cause) {
    await removeManagedStagingDirectory(stagingDirectory, packageRoot)
    throw cause
  }
  if (!(await nestedFile(installedDirectory, executableNames, signal))) {
    throw new Error('Emulator executable was not installed')
  }
}

async function removeManagedStagingDirectory(path: string, packageRoot: string): Promise<void> {
  const resolvedPath = resolve(path)
  const resolvedRoot = `${resolve(packageRoot)}${sep}`.toLocaleLowerCase('en-US')
  if (
    !resolvedPath.toLocaleLowerCase('en-US').startsWith(resolvedRoot) ||
    !basename(resolvedPath).startsWith('.orbit-installing-')
  ) {
    throw new Error('Refusing to remove an unexpected emulator staging directory')
  }
  await rm(resolvedPath, { recursive: true, force: true })
}

async function removeManagedStagingFile(path: string, root: string): Promise<void> {
  const resolvedPath = resolve(path)
  const resolvedRoot = `${resolve(root)}${sep}`.toLocaleLowerCase('en-US')
  if (
    !resolvedPath.toLocaleLowerCase('en-US').startsWith(resolvedRoot) ||
    !basename(resolvedPath).startsWith('.orbit-installing-')
  ) {
    throw new Error('Refusing to remove an unexpected emulator staging file')
  }
  await rm(resolvedPath, { force: true })
}

async function removeTemporaryDirectory(path: string): Promise<void> {
  const resolvedPath = resolve(path)
  const temporaryRoot = `${resolve(tmpdir())}${sep}`.toLocaleLowerCase('en-US')
  if (
    !resolvedPath.toLocaleLowerCase('en-US').startsWith(temporaryRoot) ||
    !basename(resolvedPath).startsWith('orbit-emulator-')
  ) {
    throw new Error('Refusing to remove an unexpected temporary directory')
  }
  await rm(resolvedPath, { recursive: true, force: true })
}

async function installRetroArchCore(
  systemId: RetroSystemId,
  temporaryDirectory: string,
  report: (
    phase: RetroEmulatorInstallPhase,
    receivedBytes?: number,
    totalBytes?: number
  ) => void,
  signal: AbortSignal
): Promise<void> {
  const preferences = retroSystemById(systemId).retroArchCores
  if (preferences.length === 0) throw new Error('RetroArch is not supported for this system')

  for (const coreName of preferences) {
    signal.throwIfAborted()
    const coreFileName = `${coreName}_libretro.dll`
    const url = validatedRetroDownloadUrl(
      `https://buildbot.libretro.com/nightly/windows/x86_64/latest/${coreFileName}.zip`
    )
    const response = await fetchTrusted(url, {
      headers: { Accept: 'application/zip' },
      signal
    })
    if (response.status === 404) continue
    if (!response.ok) throw new Error(`RetroArch core download returned HTTP ${response.status}`)

    const archivePath = join(temporaryDirectory, `${coreName}.zip`)
    await writeResponseToFile(response, archivePath, undefined, 'installing-core', report)
    await validateArchive(archivePath, signal)
    const extracted = join(temporaryDirectory, `core-${coreName}`)
    await extractArchive(archivePath, extracted, signal)
    const corePath = await nestedFile(extracted, [coreFileName], signal)
    if (!corePath) throw new Error('RetroArch core package is incomplete')
    const coreDirectory = join(managedEmulatorDirectory('retroarch'), 'cores')
    await mkdir(coreDirectory, { recursive: true })
    const stagedCorePath = join(coreDirectory, `.orbit-installing-${randomUUID()}.dll`)
    try {
      await cp(corePath, stagedCorePath, { force: true })
      signal.throwIfAborted()
      await rename(stagedCorePath, join(coreDirectory, coreFileName))
    } catch (cause) {
      await removeManagedStagingFile(stagedCorePath, coreDirectory)
      throw cause
    }
    return
  }
  throw new Error('No compatible RetroArch core is currently available')
}

function selectedEmulatorReady(
  detected: readonly DetectedRetroEmulator[],
  emulatorId: string,
  systemId: RetroSystemId
): boolean {
  return Boolean(
    detected.find(
      (candidate) => candidate.id === emulatorId && candidate.readySystems.includes(systemId)
    )
  )
}

export class RetroSetupService {
  private installInFlight: Promise<RetroSetupInstallResult> | null = null
  private installAbortController: AbortController | null = null

  async ensureSystemDirectory(systemId: RetroSystemId): Promise<RetroSystemDirectoryResult> {
    const root = managedRomRootDirectory()
    const systemDirectory = managedRomSystemDirectory(systemId)
    const existed = await pathExists(systemDirectory)
    await mkdir(systemDirectory, { recursive: true })
    const resolvedRoot = await realpath(root)
    const resolvedSystemDirectory = await realpath(systemDirectory)
    const existing = settingsStore.store.retroRomDirectories ?? []
    const normalizedRoot = resolvedRoot.toLocaleLowerCase('en-US')
    if (!existing.some((path) => path.toLocaleLowerCase('en-US') === normalizedRoot)) {
      if (existing.length >= 20) throw new Error('ROM directory limit reached')
      settingsStore.set('retroRomDirectories', [...existing, resolvedRoot])
    }
    return { systemId, directoryPath: resolvedSystemDirectory, created: !existed }
  }

  async openSystemDirectory(systemId: RetroSystemId): Promise<RetroSystemDirectoryResult> {
    const result = await this.ensureSystemDirectory(systemId)
    const error = await shell.openPath(result.directoryPath)
    if (error) throw new Error('ROM directory could not be opened')
    return result
  }

  async openEmulatorDownload(
    systemId: RetroSystemId,
    requestedEmulatorId?: string
  ): Promise<RetroEmulatorDownloadResult> {
    const available = retroEmulatorDownloadsForSystem(systemId)
    const emulator = requestedEmulatorId
      ? available.find((candidate) => candidate.id === requestedEmulatorId)
      : recommendedRetroEmulatorDownload(systemId)
    if (!emulator) throw new Error('Requested emulator is not supported for this system')

    const directory = await this.ensureSystemDirectory(systemId)
    const emulatorDirectory = managedEmulatorDirectory(emulator.id)
    await mkdir(emulatorDirectory, { recursive: true })
    const resolvedEmulatorDirectory = await realpath(emulatorDirectory)
    const folderError = await shell.openPath(resolvedEmulatorDirectory)
    if (folderError) throw new Error('Emulator directory could not be opened')
    await shell.openExternal(trustedDownloadPageUrl(emulator.downloadUrl))

    return {
      systemId,
      emulatorId: emulator.id,
      emulatorName: emulator.name,
      directoryPath: directory.directoryPath,
      emulatorDirectoryPath: resolvedEmulatorDirectory,
      firmwareMayBeRequired: emulator.firmwareSystems.includes(systemId)
    }
  }

  installEmulator(
    systemId: RetroSystemId,
    requestedEmulatorId: string | undefined,
    onProgress: InstallProgress
  ): Promise<RetroSetupInstallResult> {
    if (this.installInFlight) throw new Error('Another emulator installation is already running')
    const controller = new AbortController()
    this.installAbortController = controller
    const timeout = setTimeout(() => controller.abort(), 20 * 60 * 1_000)
    timeout.unref()
    const request = this.doInstallEmulator(
      systemId,
      requestedEmulatorId,
      onProgress,
      controller.signal
    ).finally(() => {
      clearTimeout(timeout)
      if (this.installInFlight === request) this.installInFlight = null
      if (this.installAbortController === controller) this.installAbortController = null
    })
    this.installInFlight = request
    return request
  }

  cancelEmulatorInstall(): boolean {
    if (!this.installAbortController || this.installAbortController.signal.aborted) return false
    this.installAbortController.abort()
    return true
  }

  private async doInstallEmulator(
    systemId: RetroSystemId,
    requestedEmulatorId: string | undefined,
    onProgress: InstallProgress,
    signal: AbortSignal
  ): Promise<RetroSetupInstallResult> {
    signal.throwIfAborted()
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      throw new Error('Automatic emulator installation currently requires 64-bit Windows')
    }
    const available = retroEmulatorDownloadsForSystem(systemId)
    const emulator = requestedEmulatorId
      ? available.find((candidate) => candidate.id === requestedEmulatorId)
      : recommendedRetroEmulatorDownload(systemId)
    if (!emulator) throw new Error('Requested emulator is not supported for this system')
    const provisioner = RETRO_EMULATOR_PROVISIONERS[emulator.id]
    if (!provisioner) throw new Error('Automatic installation is unavailable for this emulator')

    const report = (
      phase: RetroEmulatorInstallPhase,
      receivedBytes?: number,
      totalBytes?: number
    ): void => {
      onProgress({
        systemId,
        emulatorId: emulator.id,
        emulatorName: emulator.name,
        phase,
        receivedBytes,
        totalBytes
      })
    }

    const directory = await this.ensureSystemDirectory(systemId)
    const emulatorDirectory = managedEmulatorDirectory(emulator.id)
    await mkdir(emulatorDirectory, { recursive: true })
    const resolvedEmulatorDirectory = await realpath(emulatorDirectory)

    report('checking')
    const detectedBefore = await detectRetroEmulatorStatuses()
    signal.throwIfAborted()
    const decision = decideRetroProvisioning(systemId, emulator.id, detectedBefore)
    let emulatorInstalled = false
    let coreInstalled = false
    let temporaryDirectory: string | undefined

    try {
      if (decision !== 'use-existing') {
        temporaryDirectory = await mkdtemp(join(tmpdir(), 'orbit-emulator-'))
      }
      if (decision === 'install-emulator') {
        report('resolving')
        const resolvedPackage = await resolvePackage(provisioner, signal)
        const archivePath = join(temporaryDirectory as string, resolvedPackage.fileName)
        await downloadPackage(resolvedPackage, archivePath, report, signal)
        report('extracting')
        await installEmulatorArchive(
          emulator.id,
          archivePath,
          join(temporaryDirectory as string, 'extracted'),
          emulatorDirectory,
          signal
        )
        emulatorInstalled = true
      }
      if (emulator.id === 'retroarch' && decision !== 'use-existing') {
        report('installing-core')
        await installRetroArchCore(systemId, temporaryDirectory as string, report, signal)
        coreInstalled = true
      }

      report('verifying')
      signal.throwIfAborted()
      const detectedAfter = await detectRetroEmulatorStatuses()
      signal.throwIfAborted()
      if (!selectedEmulatorReady(detectedAfter, emulator.id, systemId)) {
        throw new Error('The emulator was installed but did not pass ORBIT verification')
      }

      const previousSelections = settingsStore.store.retroSystemEmulators ?? {}
      settingsStore.set('retroSystemEmulators', {
        ...previousSelections,
        [systemId]: emulator.id
      })
      let status: RetroLibraryStatus
      try {
        status = await retroLibraryService.refresh()
        signal.throwIfAborted()
      } catch (cause) {
        settingsStore.set('retroSystemEmulators', previousSelections)
        throw cause
      }
      if (!selectedEmulatorReady(status.emulators, emulator.id, systemId)) {
        settingsStore.set('retroSystemEmulators', previousSelections)
        throw new Error('The installed emulator is not ready for this system')
      }
      report('complete')
      return {
        systemId,
        emulatorId: emulator.id,
        emulatorName: emulator.name,
        directoryPath: directory.directoryPath,
        emulatorDirectoryPath: resolvedEmulatorDirectory,
        alreadyInstalled: decision === 'use-existing',
        emulatorInstalled,
        coreInstalled,
        firmwareMayBeRequired: emulator.firmwareSystems.includes(systemId),
        status
      }
    } finally {
      if (temporaryDirectory) {
        try {
          await removeTemporaryDirectory(temporaryDirectory)
        } catch (cause) {
          console.warn('[retro-setup] Temporary installer cleanup failed', cause)
        }
      }
    }
  }
}

export const retroSetupService = new RetroSetupService()
