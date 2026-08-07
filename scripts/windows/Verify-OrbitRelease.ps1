[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$releaseDir = Join-Path $repoRoot 'release'
$installerPath = Join-Path $releaseDir 'ORBIT-Setup-0.0.0.3-x64.exe'
$applicationPath = Join-Path $releaseDir 'win-unpacked\ORBIT.exe'
$packagedManifestPath = Join-Path $releaseDir 'win-unpacked\resources\release-manifest.json'
$certificateMetadataPath = Join-Path $repoRoot '.certificates\orbit-development.json'

foreach ($requiredPath in @($installerPath, $applicationPath, $packagedManifestPath, $certificateMetadataPath)) {
  if (!(Test-Path -LiteralPath $requiredPath)) {
    throw "Missing release artifact: $requiredPath"
  }
}

$certificateMetadata = Get-Content -LiteralPath $certificateMetadataPath -Raw | ConvertFrom-Json
$packagedManifest = Get-Content -LiteralPath $packagedManifestPath -Raw | ConvertFrom-Json
if ($packagedManifest.displayVersion -ne '0.0.0.3') {
  throw "Packaged manifest contains unexpected display version: $($packagedManifest.displayVersion)"
}

$verifiedFiles = foreach ($path in @($installerPath, $applicationPath)) {
  $signature = Get-AuthenticodeSignature -FilePath $path
  $isDevelopmentTrustPending =
    $signature.Status -eq 'UnknownError' -and
    $signature.StatusMessage -match 'Stammzertifikat|root certificate|untrusted root'
  if ($signature.Status -ne 'Valid' -and !$isDevelopmentTrustPending) {
    throw "Invalid Authenticode signature for $path ($($signature.Status): $($signature.StatusMessage))"
  }
  if ($signature.SignerCertificate.Thumbprint -ne $certificateMetadata.thumbprint) {
    throw "Unexpected signer for $path"
  }

  $file = Get-Item -LiteralPath $path
  if ($file.VersionInfo.FileVersion -notlike '0.0.0.3*') {
    throw "Unexpected Windows file version for $path`: $($file.VersionInfo.FileVersion)"
  }

  [ordered]@{
    file = $file.Name
    size = $file.Length
    sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    fileVersion = $file.VersionInfo.FileVersion
    productVersion = $file.VersionInfo.ProductVersion
    signatureStatus = if ($isDevelopmentTrustPending) { 'SignedDevelopmentTrustPending' } else { $signature.Status.ToString() }
    trustStatus = $signature.Status.ToString()
    signer = $signature.SignerCertificate.Subject
    signerThumbprint = $signature.SignerCertificate.Thumbprint
  }
}

$distributionManifest = [ordered]@{
  schemaVersion = 1
  product = 'ORBIT'
  appId = 'com.orbit.launcher'
  displayVersion = '0.0.0.3'
  packageVersion = '0.0.3'
  releaseSequence = 3
  channel = 'development'
  updateMode = 'manual-package'
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  artifacts = $verifiedFiles
}

$distributionManifestPath = Join-Path $releaseDir 'distribution-manifest.json'
$distributionManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $distributionManifestPath -Encoding UTF8

$checksumLines = $verifiedFiles | ForEach-Object { "$($_.sha256)  $($_.file)" }
$checksumLines | Set-Content -LiteralPath (Join-Path $releaseDir 'SHA256SUMS.txt') -Encoding ASCII

Write-Host 'ORBIT release verified:'
$verifiedFiles | ForEach-Object { Write-Host "  $($_.file) - $($_.fileVersion) - $($_.signatureStatus)" }
