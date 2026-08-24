[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$releaseDir = Join-Path $repoRoot 'release'
$releaseMetadata = Get-Content -LiteralPath (Join-Path $repoRoot 'resources\release-manifest.json') -Raw | ConvertFrom-Json
$displayVersion = [string]$releaseMetadata.displayVersion
$packageVersion = [string]$releaseMetadata.packageVersion
$windowsFileVersion = [string]$releaseMetadata.windowsFileVersion
$xboxPackageVersion = [string]$releaseMetadata.xboxPackageVersion
$releaseSequence = [int]$releaseMetadata.releaseSequence
$packagePath = Join-Path $releaseDir "ORBIT-Beta-XboxMode-$displayVersion-x64.appx"
$installerPath = Join-Path $releaseDir "ORBIT-Beta-XboxMode-Setup-$displayVersion-x64.exe"
$certificateMetadataPath = Join-Path $repoRoot '.certificates\orbit-development.json'
$inspectionDir = Join-Path $releaseDir '_orbit-xbox-inspection'
$readmePath = Join-Path $releaseDir 'XBOX-MODE-README.txt'

if (!(Test-Path -LiteralPath $packagePath)) { throw "Missing Xbox Mode package: $packagePath" }
if (!(Test-Path -LiteralPath $installerPath)) { throw "Missing one-click Xbox Mode setup: $installerPath" }
if (!(Test-Path -LiteralPath $certificateMetadataPath)) { throw "Missing certificate metadata: $certificateMetadataPath" }

$resolvedRelease = [System.IO.Path]::GetFullPath($releaseDir).TrimEnd('\') + '\'
$resolvedInspection = [System.IO.Path]::GetFullPath($inspectionDir)
if (!$resolvedInspection.StartsWith($resolvedRelease, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Unsafe inspection directory.'
}
if (Test-Path -LiteralPath $inspectionDir) { Remove-Item -LiteralPath $inspectionDir -Recurse -Force }

try {
  $makeAppx = Get-ChildItem (Join-Path $repoRoot '.tools\windows-sdk-buildtools') -Recurse -Filter makeappx.exe -ErrorAction Stop |
    Where-Object { $_.FullName -match '\\x64\\' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if (!$makeAppx) { throw 'MakeAppx was not found.' }

  & $makeAppx.FullName unpack /o /p $packagePath /d $inspectionDir
  if ($LASTEXITCODE -ne 0) { throw 'The Xbox Mode package could not be unpacked.' }

  [xml]$manifest = Get-Content -LiteralPath (Join-Path $inspectionDir 'AppxManifest.xml') -Raw
  $namespaceManager = [System.Xml.XmlNamespaceManager]::new($manifest.NameTable)
  $namespaceManager.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
  $namespaceManager.AddNamespace('uap3', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/3')
  $namespaceManager.AddNamespace('uap4', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/4')

  $packageIdentity = $manifest.SelectSingleNode('/f:Package/f:Identity', $namespaceManager)
  if ($packageIdentity.Name -ne 'ORBIT.GamingHome' -or $packageIdentity.Version -ne $xboxPackageVersion) {
    throw "Unexpected package identity/version: $($packageIdentity.Name) $($packageIdentity.Version)"
  }
  $universalFamily = $manifest.SelectSingleNode("/f:Package/f:Dependencies/f:TargetDeviceFamily[@Name='Windows.Universal']", $namespaceManager)
  $desktopFamily = $manifest.SelectSingleNode("/f:Package/f:Dependencies/f:TargetDeviceFamily[@Name='Windows.Desktop']", $namespaceManager)
  if (!$universalFamily -or !$desktopFamily) { throw 'The package must target both Windows.Universal and Windows.Desktop for handheld compatibility.' }
  $gamingExtension = $manifest.SelectSingleNode("//uap3:AppExtension[@Name='windows.gamingApp']", $namespaceManager)
  if (!$gamingExtension) { throw 'The windows.gamingApp extension is missing.' }
  $gamingCapability = $manifest.SelectSingleNode("//uap4:CustomCapability[@Name='Microsoft.appCategory.gamingHome_8wekyb3d8bbwe']", $namespaceManager)
  if (!$gamingCapability) { throw 'The Xbox Gaming Home custom capability is missing.' }

  foreach ($requiredPath in @(
    (Join-Path $inspectionDir 'CustomCapability.SCCD'),
    (Join-Path $inspectionDir 'Public\registration.json'),
    (Join-Path $inspectionDir 'app\ORBIT.exe'),
    (Join-Path $inspectionDir 'app\resources\release-manifest.json')
  )) {
    if (!(Test-Path -LiteralPath $requiredPath)) { throw "Package is missing: $requiredPath" }
  }

  $packagedRelease = Get-Content -LiteralPath (Join-Path $inspectionDir 'app\resources\release-manifest.json') -Raw | ConvertFrom-Json
  if ($packagedRelease.displayVersion -ne $displayVersion -or !$packagedRelease.xboxMode.enabled) {
    throw "The packaged release manifest does not describe Xbox Mode beta $displayVersion."
  }

  $certificateMetadata = Get-Content -LiteralPath $certificateMetadataPath -Raw | ConvertFrom-Json
  $signature = Get-AuthenticodeSignature -FilePath $packagePath
  if (!$signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $certificateMetadata.thumbprint) {
    throw 'The package signer does not match the ORBIT development certificate.'
  }
  if ($signature.Status -notin @('Valid', 'UnknownError')) {
    throw "Invalid AppX signature: $($signature.Status) - $($signature.StatusMessage)"
  }

  $installerSignature = Get-AuthenticodeSignature -FilePath $installerPath
  if (!$installerSignature.SignerCertificate -or $installerSignature.SignerCertificate.Thumbprint -ne $certificateMetadata.thumbprint) {
    throw 'The one-click setup signer does not match the ORBIT development certificate.'
  }
  if ($installerSignature.Status -notin @('Valid', 'UnknownError')) {
    throw "Invalid setup signature: $($installerSignature.Status) - $($installerSignature.StatusMessage)"
  }

  $file = Get-Item -LiteralPath $packagePath
  $hash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $installerFile = Get-Item -LiteralPath $installerPath
  $installerHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($installerFile.VersionInfo.FileVersion -notlike "$windowsFileVersion*") {
    throw "Unexpected setup file version: $($installerFile.VersionInfo.FileVersion)"
  }
  [ordered]@{
    schemaVersion = 1
    product = 'ORBIT'
    displayVersion = $displayVersion
    packageVersion = $packageVersion
    releaseSequence = $releaseSequence
    channel = 'beta'
    packageIdentity = 'ORBIT.GamingHome'
    applicationId = 'ORBIT'
    xboxMode = $true
    gamingAppExtension = 'windows.gamingApp'
    gamingHomeCapability = 'Microsoft.appCategory.gamingHome_8wekyb3d8bbwe'
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    artifacts = @(
      [ordered]@{
        role = 'gaming-home-package'
        file = $file.Name
        size = $file.Length
        sha256 = $hash
        signatureStatus = $signature.Status.ToString()
        signer = $signature.SignerCertificate.Subject
        signerThumbprint = $signature.SignerCertificate.Thumbprint
      },
      [ordered]@{
        role = 'one-click-installer'
        file = $installerFile.Name
        size = $installerFile.Length
        sha256 = $installerHash
        fileVersion = $installerFile.VersionInfo.FileVersion
        signatureStatus = $installerSignature.Status.ToString()
        signer = $installerSignature.SignerCertificate.Subject
        signerThumbprint = $installerSignature.SignerCertificate.Thumbprint
      }
    )
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $releaseDir 'xbox-distribution-manifest.json') -Encoding UTF8

  @(
    "$installerHash  $($installerFile.Name)",
    "$hash  $($file.Name)"
  ) | Set-Content -LiteralPath (Join-Path $releaseDir 'XBOX-SHA256SUMS.txt') -Encoding ASCII

  @"
ORBIT $displayVersion - Xbox Mode beta

Recommended: run ORBIT-Beta-XboxMode-Setup-$displayVersion-x64.exe. It is a self-contained installer.

ZIP fallback:
1. Keep all files from the ZIP in the same folder.
2. Double-click Install-OrbitXboxMode.bat.
3. Approve the administrator prompt. The installer adds the certificate only to LocalMachine\TrustedPeople,
   enables Developer Mode for the SCCD capability, and installs the AppX package.
4. The installer opens Settings > Gaming > Full screen experience. Under Choose home app, select ORBIT.

Requirements: Windows 11 build 10.0.26100.7019 or newer and a device/installation on which Xbox mode is available.
On native builds such as 26100.8328+ or 26200.8328+, no display-size override is required.
This community beta is signed with the self-signed ORBIT certificate. Verify its thumbprint before trusting it.
"@ | Set-Content -LiteralPath $readmePath -Encoding UTF8

  Write-Host "Xbox Mode artifacts verified: $($file.Name), $($installerFile.Name)"
} finally {
  if (Test-Path -LiteralPath $inspectionDir) { Remove-Item -LiteralPath $inspectionDir -Recurse -Force }
}
