[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$releaseDir = Join-Path $repoRoot 'release'
. (Join-Path $PSScriptRoot 'OrbitSigning.ps1')
$signingProfile = Get-OrbitSigningProfile -RepoRoot $repoRoot
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($signingProfile.CertificatePath)
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
    'ORBIT-Code-Signing.cer',
    'code-signing.json',
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

  $certificateThumbprint = $signingProfile.Thumbprint
  @"
ORBIT $displayVersion - Community Beta

IMPORTANT
This beta is signed with the publicly trusted Certum Open Source Code Signing certificate.
Compare its SHA-1 thumbprint with the value published by the ORBIT project:

  $certificateThumbprint

Never install a beta whose certificate has a different thumbprint. The ZIP contains only the public CER file;
the cloud private key, SimplySign token and PIN are never distributed.

NORMAL WINDOWS INSTALLATION
1. Run $standardInstaller. No certificate trust-store change is required.

XBOX MODE
1. Run $xboxInstaller from the Windows account that should own ORBIT and approve its administrator prompt.
2. Before changing Windows, setup validates the certificate, signature, package identity, Gaming Home contract,
   registration metadata, packaged release metadata, and supported Windows baseline.
3. Setup verifies public Certum trust, enables Developer Mode for the beta capability, installs the signed AppX,
   verifies registration, and only then removes a legacy self-signed ORBIT package while preserving its app data.
4. Under Settings > Gaming > Xbox mode > Choose home app, select ORBIT.
5. Optionally enable startup into Xbox Mode.

Windows 11 version 24H2 (build 26100.0) or newer is required. Availability depends on Microsoft's supported
markets, device policy, and phased Windows feature rollout. Keep Windows, Xbox, and Game Bar current. ORBIT does
not impose an Xbox app version allow-list, apply device-form overrides, or use third-party preparation tools.

The installer does not silently replace another Gaming Home app. This prevents broken Task View/FSE state if
the previous home app is later uninstalled. The selected home app is changed only in Windows Settings.

Diagnostics after Xbox installation attempts (success or failure):
  C:\ProgramData\ORBIT\Logs\xbox-mode-diagnostics.json

Integrity hashes are listed in BETA-SHA256SUMS.txt.

ONE-TIME BETA 1 MIGRATION
Beta 1 pins the previous self-signed signer and cannot accept this release through automatic update. Download and
run the all-in-one setup manually once. Future Certum-signed betas can update normally.
"@ | Set-Content -LiteralPath (Join-Path $bundleDir 'BETA-README.txt') -Encoding UTF8

  $hashTargets = @($standardInstaller, $xboxInstaller, $xboxPackage, 'ORBIT-Code-Signing.cer')
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
    certificateSubject = $signingProfile.Subject
    certificateThumbprint = $certificateThumbprint
    certificateNotAfter = $certificate.NotAfter.ToUniversalTime().ToString('o')
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    artifacts = $artifacts
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $bundleDir 'beta-distribution-manifest.json') -Encoding UTF8

  Compress-Archive -Path (Join-Path $bundleDir '*') -DestinationPath $bundlePath -CompressionLevel Optimal
  Write-Host "ORBIT community beta ready: $bundlePath"
} finally {
  if ($certificate) { $certificate.Dispose() }
  Pop-Location
}
