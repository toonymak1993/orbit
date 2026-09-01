import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { GameMetadata } from '@shared/ipc'
import { normalizeXboxPackageFamilyName } from './xboxPackageIdentity'

const XBOX_SCAN_TIMEOUT_MS = 30_000
const MAX_SCAN_OUTPUT_BYTES = 8 * 1024 * 1024

interface XboxPackageRecord {
  packageFullName?: string
  packageFamilyName?: string
  packageVersion?: string
  storeId?: string
  applicationId?: string
  name?: string
  publisher?: string
  description?: string
  installLocation?: string
  logoPath?: string
  splashPath?: string
  executable?: string
}

export interface InstalledXboxGame {
  providerGameId: string
  name: string
  installDir: string
  packageVersion: string
  packageFamilyName: string
  metadata: GameMetadata
}

// Gaming Services is the authoritative local source for current GDK games.
// Older Xbox Live UWP games are included only when their package manifest
// actually references Microsoft.Xbox.Services. No account token is read.
const XBOX_PACKAGE_SCAN_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$targetPackageFamilyName = ([string]$env:ORBIT_XBOX_PACKAGE_FAMILY).Trim()
$gamingRoot = 'HKLM:\SOFTWARE\Microsoft\GamingServices\GameConfig'
$gamingPackages = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
if (Test-Path -LiteralPath $gamingRoot) {
  Get-ChildItem -LiteralPath $gamingRoot -ErrorAction SilentlyContinue | ForEach-Object {
    [void]$gamingPackages.Add($_.PSChildName)
  }
}

function Get-PlainText([object[]]$values) {
  foreach ($value in $values) {
    $text = [string]$value
    if ($text -and -not $text.StartsWith('ms-resource:', [System.StringComparison]::OrdinalIgnoreCase)) {
      return $text.Trim()
    }
  }
  return $null
}

$records = @(
  foreach ($package in @(Get-AppxPackage -PackageTypeFilter Main -ErrorAction SilentlyContinue)) {
    if ($targetPackageFamilyName -and -not [string]::Equals(
      [string]$package.PackageFamilyName,
      $targetPackageFamilyName,
      [System.StringComparison]::OrdinalIgnoreCase
    )) { continue }
    $isGamingPackage = $gamingPackages.Contains([string]$package.PackageFullName)
    $packageName = [string]$package.Name
    if ($packageName -match '^Microsoft\.(GamingApp|GamingServices|Xbox|XboxGamingOverlay|XboxIdentityProvider)') {
      continue
    }

    $installLocation = [string]$package.InstallLocation
    $manifestPath = Join-Path $installLocation 'AppxManifest.xml'
    $gameConfigPath = Join-Path $installLocation 'MicrosoftGame.config'
    $gameConfig = $null
    $storeId = $null
    $configuredExecutable = $null
    if (Test-Path -LiteralPath $gameConfigPath) {
      try {
        [xml]$gameConfig = [System.IO.File]::ReadAllText($gameConfigPath)
        $candidateStoreId = ([string]$gameConfig.Game.StoreId).Trim().ToUpperInvariant()
        $configuredExecutable = @($gameConfig.Game.ExecutableList.Executable |
          Where-Object { $_.Name -and (-not $_.TargetDeviceFamily -or $_.TargetDeviceFamily -eq 'PC') } |
          ForEach-Object { [string]$_.Name } |
          Select-Object -First 1)[0]
        if ($candidateStoreId -match '^[A-Z0-9]{12}$' -and $configuredExecutable) {
          $storeId = $candidateStoreId
        }
      } catch {}
    }
    $isLegacyXboxGame = $false
    if (-not $isGamingPackage -and (Test-Path -LiteralPath $manifestPath)) {
      try {
        $manifestText = [System.IO.File]::ReadAllText($manifestPath)
        $isLegacyXboxGame = $manifestText.IndexOf('Microsoft.Xbox.Services', [System.StringComparison]::OrdinalIgnoreCase) -ge 0
      } catch {}
    }
    # MicrosoftGame.config is the package-owned GDK identity source. Some
    # Xbox 360 backward-compatibility packages are deliberately not present
    # below GamingServices\GameConfig, but still expose a PC executable and
    # their durable 12-character Store ID here.
    if (-not $isGamingPackage -and -not $isLegacyXboxGame -and -not $storeId) { continue }

    try {
      $manifest = Get-AppxPackageManifest -Package $package
      $applications = @($manifest.Package.Applications.Application)
      $application = $applications |
        Where-Object { $_.Id -and ($_.Executable -or $_.EntryPoint) } |
        Select-Object -First 1
      if (-not $application) { $application = $applications | Select-Object -First 1 }
      if (-not $application -or -not $application.Id) { continue }

      $shellVisuals = if ($gameConfig) { $gameConfig.Game.ShellVisuals } else { $null }
      $executableName = $configuredExecutable
      if ($isGamingPackage) {
        $packageKey = Join-Path $gamingRoot ([string]$package.PackageFullName)
        $visualKey = Join-Path $packageKey 'ShellVisuals'
        if (Test-Path -LiteralPath $visualKey) {
          $shellVisuals = Get-ItemProperty -LiteralPath $visualKey -ErrorAction SilentlyContinue
        }
        $executableKey = Join-Path $packageKey 'Executable'
        if (Test-Path -LiteralPath $executableKey) {
          $registeredExecutable = Get-ChildItem -LiteralPath $executableKey -ErrorAction SilentlyContinue |
            ForEach-Object { (Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue).Name } |
            Where-Object { $_ } |
            Select-Object -First 1
          if ($registeredExecutable) { $executableName = $registeredExecutable }
        }
      }

      $visuals = $application.VisualElements
      $name = Get-PlainText @(
        $shellVisuals.DefaultDisplayName,
        $visuals.DisplayName,
        $manifest.Package.Properties.DisplayName,
        $package.Name
      )
      if (-not $name) { continue }
      $publisher = Get-PlainText @(
        $shellVisuals.PublisherDisplayName,
        $manifest.Package.Properties.PublisherDisplayName
      )
      $description = Get-PlainText @(
        $shellVisuals.Description,
        $visuals.Description,
        $manifest.Package.Properties.Description
      )
      $logo = Get-PlainText @(
        $shellVisuals.Square480x480Logo,
        $shellVisuals.Square150x150Logo,
        $shellVisuals.StoreLogo,
        $visuals.Square150x150Logo,
        $manifest.Package.Properties.Logo
      )
      $splash = Get-PlainText @($shellVisuals.SplashScreenImage, $visuals.SplashScreen.Image)

      [pscustomobject]@{
        packageFullName = [string]$package.PackageFullName
        packageFamilyName = [string]$package.PackageFamilyName
        packageVersion = [string]$package.Version
        storeId = $storeId
        applicationId = [string]$application.Id
        name = $name
        publisher = $publisher
        description = $description
        installLocation = [string]$package.InstallLocation
        logoPath = $logo
        splashPath = $splash
        executable = Get-PlainText @($executableName, $application.Executable)
      }
    } catch {
      continue
    }
  }
)
$records | ConvertTo-Json -Depth 5 -Compress
`

function runXboxPackageScan(packageFamilyName?: string): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', XBOX_PACKAGE_SCAN_SCRIPT],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: XBOX_SCAN_TIMEOUT_MS,
        maxBuffer: MAX_SCAN_OUTPUT_BYTES,
        env: {
          ...process.env,
          ORBIT_XBOX_PACKAGE_FAMILY: packageFamilyName ?? ''
        }
      },
      (error, stdout) => {
        if (error) reject(error)
        else resolveOutput(stdout.trim())
      }
    )
  })
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text && !text.toLowerCase().startsWith('ms-resource:') ? text : undefined
}

function xboxProductId(value: unknown): string | undefined {
  const productId = safeText(value)?.toUpperCase()
  return productId && /^[A-Z0-9]{12}$/.test(productId) ? productId : undefined
}

function packageAssetPath(installLocation: string, rawPath: unknown): string | undefined {
  const asset = safeText(rawPath)
  if (!asset) return undefined
  const root = resolve(installLocation)
  const direct = resolve(root, asset.replace(/[\\/]+/g, '\\'))
  const rootRelative = relative(root, direct)
  if (rootRelative.startsWith('..') || isAbsolute(rootRelative)) return undefined
  if (existsSync(direct)) return direct

  // AppX manifests can reference an unqualified resource name while the file on
  // disk carries a scale/contrast qualifier (for example `.scale-200.png`).
  const folder = dirname(direct)
  const extension = extname(direct)
  const baseName = direct.slice(folder.length + 1, direct.length - extension.length)
  try {
    const variant = readdirSync(folder)
      .filter((file) => {
        const lower = file.toLowerCase()
        return (
          lower.startsWith(`${baseName.toLowerCase()}.`) &&
          lower.endsWith(extension.toLowerCase())
        )
      })
      .sort((left, right) => {
        const leftPreferred = /scale-200/i.test(left) ? 1 : 0
        const rightPreferred = /scale-200/i.test(right) ? 1 : 0
        return rightPreferred - leftPreferred || left.localeCompare(right)
      })[0]
    return variant ? join(folder, variant) : undefined
  } catch {
    return undefined
  }
}

function parseRecords(output: string): XboxPackageRecord[] {
  if (!output) return []
  const parsed = JSON.parse(output) as XboxPackageRecord | XboxPackageRecord[] | null
  if (!parsed) return []
  return Array.isArray(parsed) ? parsed : [parsed]
}

async function scanInstalledXboxGamesInternal(
  packageFamilyName?: string
): Promise<Map<string, InstalledXboxGame>> {
  const records = parseRecords(await runXboxPackageScan(packageFamilyName))
  const result = new Map<string, InstalledXboxGame>()

  for (const record of records) {
    const family = safeText(record.packageFamilyName)
    const applicationId = safeText(record.applicationId)
    const name = safeText(record.name)
    const installLocation = safeText(record.installLocation)
    if (!family || !applicationId || !name || !installLocation || !existsSync(installLocation)) continue

    // Prefer the Store ID embedded in MicrosoftGame.config so the installed
    // package rejoins the existing owned-library record after every restart.
    // PFN!Application remains the launch identity and the safe fallback for
    // older UWP packages without a Store ID.
    const applicationIdentity = `${family}!${applicationId}`
    const providerGameId = xboxProductId(record.storeId) ?? applicationIdentity
    const logo = packageAssetPath(installLocation, record.logoPath)
    const splash = packageAssetPath(installLocation, record.splashPath)
    const publisher = safeText(record.publisher)
    const description = safeText(record.description)
    const metadata: GameMetadata = {
      summary: description,
      description,
      publishers: publisher ? [publisher] : undefined,
      platforms: ['windows'],
      storeUrl: `ms-windows-store://pdp/?PFN=${encodeURIComponent(family)}`,
      launchUri: `shell:AppsFolder\\${applicationIdentity}`,
      launchExecutable: safeText(record.executable),
      backgroundUrl: splash ? pathToFileURL(splash).href : undefined,
      iconUrl: logo ? pathToFileURL(logo).href : undefined,
      artwork: {
        horizontal: splash ? [pathToFileURL(splash).href] : undefined,
        icon: logo ? [pathToFileURL(logo).href] : undefined
      }
    }

    result.set(providerGameId, {
      providerGameId,
      name,
      installDir: installLocation,
      packageVersion: safeText(record.packageVersion) ?? '',
      packageFamilyName: family,
      metadata
    })
  }

  return result
}

/** Returns only locally installed, launchable Xbox/Microsoft Store games. */
export async function scanInstalledXboxGames(): Promise<Map<string, InstalledXboxGame>> {
  return scanInstalledXboxGamesInternal()
}

/** Resolves one completed PackageCatalog operation without rescanning every
 * AppX manifest. The family name is validated before it reaches PowerShell. */
export async function scanInstalledXboxGameByFamily(
  packageFamilyName: string
): Promise<InstalledXboxGame | undefined> {
  const normalized = normalizeXboxPackageFamilyName(packageFamilyName)
  if (!normalized) return undefined
  const games = await scanInstalledXboxGamesInternal(normalized)
  return [...games.values()].find(
    (game) => game.packageFamilyName.toLowerCase() === normalized.toLowerCase()
  )
}
