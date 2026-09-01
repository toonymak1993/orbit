import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scanInstalledXboxGames } from '../src/main/xbox/xboxInstall.ts'

interface XboxPackageCandidate {
  packageFullName: string
  packageFamilyName: string
  applicationId: string
  storeId?: string
  signal: 'gaming-services' | 'microsoft-game-config' | 'xbox-services-manifest'
}

interface StoredLibraryGame {
  provider?: string
  providerGameId?: string
  name?: string
  installed?: boolean
  metadata?: { launchUri?: string }
}

interface LibraryDatabase {
  accounts?: {
    'orbit-default'?: {
      games?: Record<string, StoredLibraryGame>
    }
  }
}

// This intentionally discovers candidates independently from xboxInstall.ts.
// A package-owned MicrosoftGame.config, Gaming Services registration or the
// legacy Xbox Services manifest marker is sufficient to enter the audit.
const XBOX_PACKAGE_CANDIDATE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$gamingRoot = 'HKLM:\SOFTWARE\Microsoft\GamingServices\GameConfig'
$gamingPackages = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
if (Test-Path -LiteralPath $gamingRoot) {
  Get-ChildItem -LiteralPath $gamingRoot -ErrorAction SilentlyContinue | ForEach-Object {
    [void]$gamingPackages.Add($_.PSChildName)
  }
}

$candidates = @(
  foreach ($package in @(Get-AppxPackage -PackageTypeFilter Main -ErrorAction SilentlyContinue)) {
    $installLocation = [string]$package.InstallLocation
    if (-not $installLocation) { continue }
    $manifestPath = Join-Path $installLocation 'AppxManifest.xml'
    if (-not (Test-Path -LiteralPath $manifestPath)) { continue }

    $isGamingPackage = $gamingPackages.Contains([string]$package.PackageFullName)
    $isLegacyXboxGame = $false
    try {
      $manifestText = [System.IO.File]::ReadAllText($manifestPath)
      $isLegacyXboxGame = $manifestText.IndexOf(
        'Microsoft.Xbox.Services',
        [System.StringComparison]::OrdinalIgnoreCase
      ) -ge 0
    } catch {}

    $storeId = $null
    $configuredExecutable = $null
    $gameConfigPath = Join-Path $installLocation 'MicrosoftGame.config'
    if (Test-Path -LiteralPath $gameConfigPath) {
      try {
        [xml]$gameConfig = [System.IO.File]::ReadAllText($gameConfigPath)
        $candidateStoreId = ([string]$gameConfig.Game.StoreId).Trim().ToUpperInvariant()
        $configuredExecutable = @($gameConfig.Game.ExecutableList.Executable |
          Where-Object { $_.Name -and (-not $_.TargetDeviceFamily -or $_.TargetDeviceFamily -eq 'PC') } |
          Select-Object -First 1)[0]
        if ($candidateStoreId -match '^[A-Z0-9]{12}$' -and $configuredExecutable) {
          $storeId = $candidateStoreId
        }
      } catch {}
    }
    if (-not $isGamingPackage -and -not $isLegacyXboxGame -and -not $storeId) { continue }

    try {
      $manifest = Get-AppxPackageManifest -Package $package
      $applications = @($manifest.Package.Applications.Application)
      $application = $applications |
        Where-Object { $_.Id -and ($_.Executable -or $_.EntryPoint) } |
        Select-Object -First 1
      if (-not $application) { $application = $applications | Select-Object -First 1 }
      if (-not $application -or -not $application.Id) { continue }

      $signal = if ($isGamingPackage) {
        'gaming-services'
      } elseif ($storeId) {
        'microsoft-game-config'
      } else {
        'xbox-services-manifest'
      }
      [pscustomobject]@{
        packageFullName = [string]$package.PackageFullName
        packageFamilyName = [string]$package.PackageFamilyName
        applicationId = [string]$application.Id
        storeId = $storeId
        signal = $signal
      }
    } catch {}
  }
)
$candidates | ConvertTo-Json -Depth 4 -Compress
`

function runCandidateAudit(): Promise<XboxPackageCandidate[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', XBOX_PACKAGE_CANDIDATE_SCRIPT],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024
      },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        const output = stdout.trim()
        if (!output) {
          resolve([])
          return
        }
        const parsed = JSON.parse(output) as XboxPackageCandidate | XboxPackageCandidate[]
        resolve(Array.isArray(parsed) ? parsed : [parsed])
      }
    )
  })
}

function activeLibraryGames(): Record<string, StoredLibraryGame> | undefined {
  const appData = process.env.APPDATA
  if (!appData) return undefined
  const databasePath = join(appData, 'orbit', 'orbit-library-v2.json')
  if (!existsSync(databasePath)) return undefined
  const database = JSON.parse(readFileSync(databasePath, 'utf8')) as LibraryDatabase
  return database.accounts?.['orbit-default']?.games
}

if (process.platform !== 'win32') {
  console.log('Xbox library reconciliation skipped: Windows is required.')
  process.exit(0)
}

const [candidates, detectedGames] = await Promise.all([
  runCandidateAudit(),
  scanInstalledXboxGames()
])
const packagesOnly = process.argv.includes('--packages-only')
const detectedByFamily = new Map(
  [...detectedGames.values()].map((game) => [game.packageFamilyName.toLowerCase(), game])
)

const missedPackages = candidates.filter(
  (candidate) => !detectedByFamily.has(candidate.packageFamilyName.toLowerCase())
)
assert.deepEqual(
  missedPackages.map((candidate) => ({
    packageFamilyName: candidate.packageFamilyName,
    signal: candidate.signal
  })),
  [],
  'ORBIT missed locally installed Xbox package candidates'
)

for (const candidate of candidates) {
  const detected = detectedByFamily.get(candidate.packageFamilyName.toLowerCase())
  assert.ok(detected)
  if (candidate.storeId) {
    assert.equal(
      detected.providerGameId,
      candidate.storeId,
      `Store-ID mapping drifted for ${candidate.packageFamilyName}`
    )
  }
  assert.equal(
    detected.metadata.launchUri,
    `shell:AppsFolder\\${candidate.packageFamilyName}!${candidate.applicationId}`,
    `Launch identity drifted for ${candidate.packageFamilyName}`
  )
}

console.log(
  `Xbox package coverage passed: ${candidates.length} independently discovered candidates, ` +
    `${detectedGames.size} detected games.`
)

const libraryGames = activeLibraryGames()
if (libraryGames && !packagesOnly) {
  const staleInstallStates = [...detectedGames.values()]
    .map((detected) => ({
      detected,
      stored: libraryGames[`xbox:${detected.providerGameId}`]
    }))
    .filter(({ stored }) => !stored?.installed)
    .map(({ detected, stored }) => ({
      providerGameId: detected.providerGameId,
      packageFamilyName: detected.packageFamilyName,
      storedName: stored?.name,
      storedInstalled: stored?.installed ?? null
    }))
  assert.deepEqual(
    staleInstallStates,
    [],
    'ORBIT library contains missing or stale install states for detected Xbox packages'
  )
}

console.log(
  packagesOnly
    ? 'Xbox package-only reconciliation passed; persisted library check was skipped.'
    : `Xbox library reconciliation passed: ${candidates.length} package candidates, ` +
        `${detectedGames.size} detected games${libraryGames ? ', persisted library matched' : ''}.`
)
