import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GameMetadata } from '@shared/ipc'

const XBOX_APP_PACKAGE_FAMILY = 'Microsoft.GamingApp_8wekyb3d8bbwe'
const XBOX_APP_CACHE_TIMEOUT_MS = 45_000
const MAX_CACHE_OUTPUT_BYTES = 16 * 1024 * 1024

interface XboxAppCacheRecord {
  productId?: string
  title?: string
  description?: string
  developer?: string
  publisher?: string
  categories?: unknown
  releaseDate?: string
  packageFamilyName?: string
  verticalUrls?: unknown
  horizontalUrls?: unknown
  iconUrls?: unknown
}

interface XboxAppCachePayload {
  available?: boolean
  activeSubscription?: boolean
  games?: XboxAppCacheRecord[]
}

export interface XboxAppGame {
  providerGameId: string
  name: string
  packageFamilyName?: string
  metadata: GameMetadata
}

export interface XboxAppLibrarySnapshot {
  available: boolean
  activeSubscription: boolean
  games: Map<string, XboxAppGame>
  byPackageFamilyName: Map<string, XboxAppGame>
}

// The Xbox app keeps catalog/product data in this SQLite cache. The query is
// deliberately scoped to collections and product summaries; identity, WebView
// storage, cookies and tokens are never opened. `immutable=1` gives us a safe
// read-only snapshot even while the Xbox app is running.
const XBOX_APP_CACHE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$databasePath = Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.GamingApp_8wekyb3d8bbwe\LocalState\AsyncCache.db'
if (-not (Test-Path -LiteralPath $databasePath)) {
  [pscustomobject]@{ available = $false; activeSubscription = $false; games = @() } |
    ConvertTo-Json -Compress
  exit 0
}

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class OrbitXboxSqliteReader
{
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private static extern int sqlite3_open_v2(string file, out IntPtr database, int flags, IntPtr vfs);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private static extern int sqlite3_prepare_v2(IntPtr database, string sql, int bytes, out IntPtr statement, IntPtr tail);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_step(IntPtr statement);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_finalize(IntPtr statement);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_close(IntPtr database);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr sqlite3_column_text(IntPtr statement, int column);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_column_bytes(IntPtr statement, int column);

    private static string ReadText(IntPtr statement, int column)
    {
        var pointer = sqlite3_column_text(statement, column);
        var length = sqlite3_column_bytes(statement, column);
        if (pointer == IntPtr.Zero || length <= 0) return string.Empty;
        var bytes = new byte[length];
        Marshal.Copy(pointer, bytes, 0, length);
        return Encoding.UTF8.GetString(bytes);
    }

    public static string[][] ReadScope(string path, string scope)
    {
        IntPtr database;
        var uri = "file:///" + path.Replace('\\', '/') + "?mode=ro&immutable=1";
        if (sqlite3_open_v2(uri, out database, 65, IntPtr.Zero) != 0)
            throw new InvalidOperationException("Xbox cache could not be opened read-only.");
        var rows = new List<string[]>();
        IntPtr statement = IntPtr.Zero;
        try
        {
            var escaped = scope.Replace("'", "''");
            var sql = "select key, value from AsyncCache where scope='" + escaped + "'";
            if (sqlite3_prepare_v2(database, sql, -1, out statement, IntPtr.Zero) != 0)
                throw new InvalidOperationException("Xbox cache query could not be prepared.");
            while (sqlite3_step(statement) == 100)
                rows.Add(new[] { ReadText(statement, 0), ReadText(statement, 1) });
            return rows.ToArray();
        }
        finally
        {
            if (statement != IntPtr.Zero) sqlite3_finalize(statement);
            sqlite3_close(database);
        }
    }
}
'@

function Get-Urls([object[]]$artwork, [string[]]$purposes) {
  $result = @()
  foreach ($purpose in $purposes) {
    $result += @($artwork |
      Where-Object { $_.purpose -eq $purpose -and ([string]$_.uri).StartsWith('https://') } |
      Sort-Object { ([long]$_.width) * ([long]$_.height) } -Descending |
      ForEach-Object { [string]$_.uri })
  }
  return @($result | Select-Object -Unique)
}

function Get-CanonicalTitle([string]$title) {
  return ($title -replace '[®™©]', '' -replace '\s*[-–]\s*(Windows|PC)\s*$', '' -replace '\s*\((Windows|PC)\)\s*$', '' -replace '\s+', ' ').Trim().ToLowerInvariant()
}

$subscriptionRows = [OrbitXboxSqliteReader]::ReadScope($databasePath, 'game_subscriptions_info')
$subscriptionRow = $subscriptionRows | Where-Object { $_[0] -eq '' } | Select-Object -First 1
$subscriptionData = if ($subscriptionRow) { ($subscriptionRow[1] | ConvertFrom-Json).products.data } else { $null }

$userRows = [OrbitXboxSqliteReader]::ReadScope($databasePath, 'user_subscriptions')
$userRow = $userRows | Where-Object { $_[0] -eq 'subscriptions' } | Select-Object -First 1
$activeProductIds = @()
if ($userRow) {
  $accounts = $userRow[1] | ConvertFrom-Json
  foreach ($account in $accounts.PSObject.Properties.Value) {
    $activeProductIds += @($account.PSObject.Properties.Value |
      Where-Object { $_.isActive -eq $true -and $_.passStatus -eq 'Active' } |
      ForEach-Object { [string]$_.productId })
  }
}

$productRows = [OrbitXboxSqliteReader]::ReadScope($databasePath, 'product_summary')
$products = @{}
foreach ($row in $productRows) {
  try {
    $data = ($row[1] | ConvertFrom-Json).data
    if ($data -and $data.StoreId) { $products[[string]$data.StoreId] = $data }
  } catch {}
}

# Current Xbox app builds no longer retain subscription products in the
# product_summary scope. The signed-in subscription records themselves remain
# authoritative and already expose active/pass status. Restrict the imported
# catalog to PC entitlements; console-only relations must not appear in ORBIT.
$hasActiveSubscription = $activeProductIds.Count -gt 0
$allowedPlans = @('GPPC', 'NAKUTOMIPC')

$deduplicated = @{}
if ($hasActiveSubscription -and $subscriptionData) {
  foreach ($data in $products.Values) {
    if ($data.productKind -ne 'GAME' -or -not (@($data.availablePlatforms) -contains 'PC')) { continue }
    $storeId = [string]$data.StoreId
    $relationProperty = $subscriptionData.PSObject.Properties[$storeId]
    if (-not $relationProperty) { continue }
    $included = $false
    foreach ($plan in $allowedPlans) {
      $planProperty = $relationProperty.Value.subscriptions.PSObject.Properties[$plan]
      if ($planProperty -and $planProperty.Value.included -eq $true) { $included = $true; break }
    }
    if (-not $included) { continue }
    $title = ([string]$data.title).Trim()
    if (-not $title) { continue }

    $packageFamilyName = @($data.alternateIds |
      Where-Object { $_.idType -eq 'PACKAGEFAMILYNAME' } |
      ForEach-Object { [string]$_.id } |
      Select-Object -First 1)[0]
    $verticalUrls = Get-Urls @($data.artwork) @('POSTER', 'BRANDEDKEYART')
    $horizontalUrls = Get-Urls @($data.artwork) @('SUPERHEROART', 'TITLEDHEROART')
    $iconUrls = Get-Urls @($data.artwork) @('LOGO', 'BOXART')
    $record = [pscustomobject]@{
      productId = $storeId
      title = $title
      description = [string]$data.shortDescription
      developer = [string]$data.developer
      publisher = [string]$data.publisher
      categories = @($data.categories | ForEach-Object { [string]$_ })
      releaseDate = [string]$data.releaseDate
      packageFamilyName = $packageFamilyName
      verticalUrls = $verticalUrls
      horizontalUrls = $horizontalUrls
      iconUrls = $iconUrls
      downloadable = $data.isDownloadable -eq $true
    }
    $canonical = Get-CanonicalTitle $title
    $current = $deduplicated[$canonical]
    $score = ($(if ($record.downloadable) { 4 } else { 0 })) + ($(if ($packageFamilyName) { 2 } else { 0 })) + ($(if ($verticalUrls.Count -gt 0) { 1 } else { 0 }))
    $currentScore = if ($current) {
      ($(if ($current.downloadable) { 4 } else { 0 })) + ($(if ($current.packageFamilyName) { 2 } else { 0 })) + ($(if ($current.verticalUrls.Count -gt 0) { 1 } else { 0 }))
    } else { -1 }
    if (-not $current -or $score -gt $currentScore) { $deduplicated[$canonical] = $record }
  }
}

[pscustomobject]@{
  available = $true
  activeSubscription = $hasActiveSubscription
  games = @($deduplicated.Values)
} | ConvertTo-Json -Depth 7 -Compress
`

function cachePath(): string {
  return join(
    process.env.LOCALAPPDATA ?? '',
    'Packages',
    XBOX_APP_PACKAGE_FAMILY,
    'LocalState',
    'AsyncCache.db'
  )
}

function runXboxAppCacheScan(): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', XBOX_APP_CACHE_SCRIPT],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: XBOX_APP_CACHE_TIMEOUT_MS,
        maxBuffer: MAX_CACHE_OUTPUT_BYTES
      },
      (error, stdout) => {
        if (error) reject(error)
        else resolveOutput(stdout.trim())
      }
    )
  })
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function textArray(value: unknown): string[] | undefined {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const values = [...new Set(source.map(text).filter((item): item is string => Boolean(item)))]
  return values.length > 0 ? values : undefined
}

function httpsUrls(value: unknown): string[] | undefined {
  const values = textArray(value)?.filter((url) => url.startsWith('https://'))
  return values && values.length > 0 ? values : undefined
}

/** Reads the playable PC Game Pass collection already cached by the Xbox app. */
export async function scanXboxAppLibrary(): Promise<XboxAppLibrarySnapshot> {
  if (process.platform !== 'win32' || !existsSync(cachePath())) {
    return {
      available: false,
      activeSubscription: false,
      games: new Map(),
      byPackageFamilyName: new Map()
    }
  }

  const output = await runXboxAppCacheScan()
  const payload = JSON.parse(output) as XboxAppCachePayload
  const games = new Map<string, XboxAppGame>()
  const byPackageFamilyName = new Map<string, XboxAppGame>()

  for (const record of payload.games ?? []) {
    const productId = text(record.productId)?.toUpperCase()
    const name = text(record.title)
    if (!productId || !/^[A-Z0-9]{12}$/.test(productId) || !name) continue
    const vertical = httpsUrls(record.verticalUrls)
    const horizontal = httpsUrls(record.horizontalUrls)
    const icon = httpsUrls(record.iconUrls)
    const packageFamilyName = text(record.packageFamilyName)
    const description = text(record.description)
    const developer = text(record.developer)
    const publisher = text(record.publisher)
    const game: XboxAppGame = {
      providerGameId: productId,
      name,
      packageFamilyName,
      metadata: {
        summary: description,
        description,
        genres: textArray(record.categories),
        developers: developer ? [developer] : undefined,
        publishers: publisher ? [publisher] : undefined,
        releaseDateText: text(record.releaseDate),
        platforms: ['windows'],
        storeUrl: `msxbox://game/?productId=${productId}`,
        backgroundUrl: horizontal?.[0],
        storeHeaderUrl: horizontal?.[0],
        iconUrl: icon?.[0],
        artwork: { vertical, horizontal, icon }
      }
    }
    games.set(productId, game)
    if (packageFamilyName) byPackageFamilyName.set(packageFamilyName.toLowerCase(), game)
  }

  return {
    available: payload.available === true,
    activeSubscription: payload.activeSubscription === true,
    games,
    byPackageFamilyName
  }
}
