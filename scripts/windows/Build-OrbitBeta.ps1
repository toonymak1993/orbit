[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$releaseDir = Join-Path $repoRoot 'release'
$releaseMetadata = Get-Content -LiteralPath (Join-Path $repoRoot 'resources\release-manifest.json') -Raw | ConvertFrom-Json
$displayVersion = [string]$releaseMetadata.displayVersion
$bundleName = "ORBIT-Beta-$displayVersion-x64"
$bundleDir = Join-Path $releaseDir $bundleName
$bundlePath = Join-Path $releaseDir "$bundleName.zip"

function Assert-ReleaseChildPath {
  param([string]$Path)
  $resolvedRelease = [System.IO.Path]::GetFullPath($releaseDir).TrimEnd('\') + '\'
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  if (!$resolvedPath.StartsWith($resolvedRelease, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the release directory: $resolvedPath"
  }
}

Push-Location $repoRoot
try {
  & (Join-Path $PSScriptRoot 'Build-OrbitInstaller.ps1')
  & (Join-Path $PSScriptRoot 'Build-OrbitXboxPackage.ps1') -SkipCompile
  $certificateMetadata = Get-Content -LiteralPath (Join-Path $repoRoot '.certificates\orbit-development.json') -Raw | ConvertFrom-Json

  Assert-ReleaseChildPath $bundleDir
  Assert-ReleaseChildPath $bundlePath
  if (Test-Path -LiteralPath $bundleDir) { Remove-Item -LiteralPath $bundleDir -Recurse -Force }
  if (Test-Path -LiteralPath $bundlePath) { Remove-Item -LiteralPath $bundlePath -Force }
  New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null

  $standardInstaller = "ORBIT-Beta-Setup-$displayVersion-x64.exe"
  $xboxInstaller = "ORBIT-Beta-XboxMode-Setup-$displayVersion-x64.exe"
  $xboxPackage = "ORBIT-Beta-XboxMode-$displayVersion-x64.appx"
  $publicFiles = @(
    $standardInstaller,
    $xboxInstaller,
    $xboxPackage,
    'ORBIT-Development.cer',
    'Install-OrbitDevelopmentCertificate.ps1',
    'Install-OrbitXboxMode.bat',
    'Install-OrbitXboxMode.ps1',
    'release-manifest.json',
    'distribution-manifest.json',
    'xbox-distribution-manifest.json',
    'SHA256SUMS.txt',
    'XBOX-SHA256SUMS.txt',
    'XBOX-MODE-README.txt'
  )
  foreach ($fileName in $publicFiles) {
    $source = Join-Path $releaseDir $fileName
    if (!(Test-Path -LiteralPath $source)) { throw "Missing beta artifact: $source" }
    Copy-Item -LiteralPath $source -Destination $bundleDir -Force
  }

  $certificateThumbprint = [string]$certificateMetadata.thumbprint
  @"
ORBIT $displayVersion - Community Beta

IMPORTANT
This beta is signed with a self-signed ORBIT certificate because no commercial publisher certificate is used yet.
Before trusting the certificate, compare its SHA-1 thumbprint with the value published by the ORBIT project:

  $certificateThumbprint

Never install a beta whose certificate has a different thumbprint. The ZIP contains only the public CER file;
the private signing key is never distributed.

NORMAL WINDOWS INSTALLATION
1. Right-click Install-OrbitDevelopmentCertificate.ps1 and run it with PowerShell as administrator.
2. Run $standardInstaller.

XBOX MODE / FULL SCREEN EXPERIENCE
1. Run $xboxInstaller as administrator.
2. The setup trusts the same ORBIT certificate, enables Developer Mode for the Gaming Home capability,
   installs the signed AppX, verifies the Gaming Home registration, and opens Windows FSE settings.
3. Under Settings > Gaming > Full screen experience > Choose home app, select ORBIT.
4. Optionally enable startup into Full screen experience.

Windows 11 build 26100.7019 or newer is required. Native builds such as 26100.8328+ and 26200.8328+
do not need a display-size override. On older or non-enabled systems, prepare FSE separately with the current
Xbox Full Screen Experience Tool: https://github.com/8bit2qubit/XboxFullScreenExperienceTool

The installer does not silently replace another Gaming Home app. This prevents broken Task View/FSE state if
the previous home app is later uninstalled. The selected home app is changed only in Windows Settings.

Diagnostics after Xbox installation:
  C:\ProgramData\ORBIT\Logs\xbox-mode-diagnostics.json

Integrity hashes are listed in BETA-SHA256SUMS.txt.
"@ | Set-Content -LiteralPath (Join-Path $bundleDir 'BETA-README.txt') -Encoding UTF8

  $hashTargets = @($standardInstaller, $xboxInstaller, $xboxPackage, 'ORBIT-Development.cer')
  $artifacts = foreach ($fileName in $hashTargets) {
    $path = Join-Path $bundleDir $fileName
    $file = Get-Item -LiteralPath $path
    [ordered]@{
      file = $file.Name
      size = $file.Length
      sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  $artifacts | ForEach-Object { "$($_.sha256)  $($_.file)" } |
    Set-Content -LiteralPath (Join-Path $bundleDir 'BETA-SHA256SUMS.txt') -Encoding ASCII

  [ordered]@{
    schemaVersion = 1
    product = 'ORBIT'
    channel = 'beta'
    displayVersion = $displayVersion
    packageVersion = [string]$releaseMetadata.packageVersion
    windowsFileVersion = [string]$releaseMetadata.windowsFileVersion
    xboxPackageVersion = [string]$releaseMetadata.xboxPackageVersion
    releaseSequence = [int]$releaseMetadata.releaseSequence
    certificateSubject = [string]$certificateMetadata.subject
    certificateThumbprint = $certificateThumbprint
    certificateNotAfter = [string]$certificateMetadata.notAfter
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    artifacts = $artifacts
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $bundleDir 'beta-distribution-manifest.json') -Encoding UTF8

  Compress-Archive -Path (Join-Path $bundleDir '*') -DestinationPath $bundlePath -CompressionLevel Optimal
  Write-Host "ORBIT community beta ready: $bundlePath"
} finally {
  Pop-Location
}
