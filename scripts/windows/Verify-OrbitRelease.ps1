[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$env:PSModulePath = "$(Join-Path $PSHOME 'Modules')$([IO.Path]::PathSeparator)$env:PSModulePath"
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$releaseDir = Join-Path $repoRoot 'release'
. (Join-Path $PSScriptRoot 'OrbitSigning.ps1')
$signingProfile = Get-OrbitSigningProfile -RepoRoot $repoRoot
$releaseMetadata = Get-Content -LiteralPath (Join-Path $repoRoot 'resources\release-manifest.json') -Raw | ConvertFrom-Json
$displayVersion = [string]$releaseMetadata.displayVersion
$packageVersion = [string]$releaseMetadata.packageVersion
$releaseChannel = ([string]$releaseMetadata.channel).Trim().ToLowerInvariant()
if ($releaseChannel -notin @('beta', 'stable')) {
  throw "Unsupported ORBIT release channel: $releaseChannel"
}
$installerPrefix = if ($releaseChannel -eq 'beta') { 'ORBIT-Beta-Setup' } else { 'ORBIT-Setup' }
$windowsFileVersion = [string]$releaseMetadata.windowsFileVersion
$releaseSequence = [int]$releaseMetadata.releaseSequence
$installerPath = Join-Path $releaseDir "$installerPrefix-$displayVersion-x64.exe"
$applicationPath = Join-Path $releaseDir 'win-unpacked\ORBIT.exe'
$packagedManifestPath = Join-Path $releaseDir 'win-unpacked\resources\release-manifest.json'
$releaseCertificatePath = Join-Path $releaseDir 'ORBIT-Code-Signing.cer'
$releaseSigningMetadataPath = Join-Path $releaseDir 'code-signing.json'
$legalDocumentNames = @('LICENSE', 'LICENSE_EXCEPTION.md', 'THIRD_PARTY_NOTICES.md')
$packagedLegalDocumentPaths = @($legalDocumentNames | ForEach-Object {
  Join-Path $releaseDir "win-unpacked\resources\$_"
})

foreach ($requiredPath in @(
  $installerPath,
  $applicationPath,
  $packagedManifestPath,
  $releaseCertificatePath,
  $releaseSigningMetadataPath
) + @($legalDocumentNames | ForEach-Object { Join-Path $repoRoot $_ }) + $packagedLegalDocumentPaths) {
  if (!(Test-Path -LiteralPath $requiredPath)) {
    throw "Missing release artifact: $requiredPath"
  }
}

foreach ($legalDocumentName in $legalDocumentNames) {
  $sourcePath = Join-Path $repoRoot $legalDocumentName
  $packagedPath = Join-Path $releaseDir "win-unpacked\resources\$legalDocumentName"
  $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
  $packagedHash = (Get-FileHash -LiteralPath $packagedPath -Algorithm SHA256).Hash
  if ($sourceHash -cne $packagedHash) {
    throw "Packaged legal document does not match the repository source: $legalDocumentName"
  }
}

$releaseCertificateHash = (Get-FileHash -LiteralPath $releaseCertificatePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($releaseCertificateHash -cne $signingProfile.CertificateSha256) {
  throw 'The copied public release certificate does not match the pinned Certum certificate.'
}
$releaseSigningMetadataHash = (Get-FileHash -LiteralPath $releaseSigningMetadataPath -Algorithm SHA256).Hash
$sourceSigningMetadataHash = (Get-FileHash -LiteralPath $signingProfile.MetadataPath -Algorithm SHA256).Hash
if ($releaseSigningMetadataHash -cne $sourceSigningMetadataHash) {
  throw 'The copied signing metadata does not match the repository source.'
}
$packagedManifest = Get-Content -LiteralPath $packagedManifestPath -Raw | ConvertFrom-Json
if ($packagedManifest.displayVersion -ne $displayVersion) {
  throw "Packaged manifest contains unexpected display version: $($packagedManifest.displayVersion)"
}

$verifiedFiles = foreach ($path in @($installerPath, $applicationPath)) {
  $signature = Assert-OrbitSignedFile -Path $path -Profile $signingProfile

  $file = Get-Item -LiteralPath $path
  if ($file.VersionInfo.FileVersion -notlike "$windowsFileVersion*") {
    throw "Unexpected Windows file version for $path`: $($file.VersionInfo.FileVersion)"
  }

  [ordered]@{
    file = $file.Name
    size = $file.Length
    sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    fileVersion = $file.VersionInfo.FileVersion
    productVersion = $file.VersionInfo.ProductVersion
    signatureStatus = $signature.Status.ToString()
    trustStatus = $signature.Status.ToString()
    signer = $signature.SignerCertificate.Subject
    signerThumbprint = $signature.SignerCertificate.Thumbprint
    timestampSigner = $signature.TimeStamperCertificate.Subject
  }
}

$distributionManifest = [ordered]@{
  schemaVersion = 1
  product = 'ORBIT'
  appId = 'com.orbit.launcher'
  displayVersion = $displayVersion
  packageVersion = $packageVersion
  releaseSequence = $releaseSequence
  channel = $releaseChannel
  updateMode = [string]$releaseMetadata.updateMode
  automaticUpdatesEnabled = [bool]$releaseMetadata.automaticUpdatesEnabled
  updateRepository = "$($releaseMetadata.updates.owner)/$($releaseMetadata.updates.repository)"
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  artifacts = $verifiedFiles
}

$distributionManifestPath = Join-Path $releaseDir 'distribution-manifest.json'
$distributionManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $distributionManifestPath -Encoding UTF8

$checksumLines = $verifiedFiles | ForEach-Object { "$($_.sha256)  $($_.file)" }
$checksumLines | Set-Content -LiteralPath (Join-Path $releaseDir 'SHA256SUMS.txt') -Encoding ASCII

Write-Host 'ORBIT release verified:'
$verifiedFiles | ForEach-Object { Write-Host "  $($_.file) - $($_.fileVersion) - $($_.signatureStatus)" }
