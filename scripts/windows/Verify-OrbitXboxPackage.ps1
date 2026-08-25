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
$xboxMinimumWindowsVersion = [version][string]$releaseMetadata.xboxMode.minimumWindowsVersion
$releaseSequence = [int]$releaseMetadata.releaseSequence
$packagePath = Join-Path $releaseDir "ORBIT-Beta-XboxMode-$displayVersion-x64.appx"
$installerPath = Join-Path $releaseDir "ORBIT-Beta-XboxMode-Setup-$displayVersion-x64.exe"
$certificatePath = Join-Path $releaseDir 'ORBIT-Development.cer'
$installScriptPath = Join-Path $releaseDir 'Install-OrbitXboxMode.ps1'
$installBatchPath = Join-Path $releaseDir 'Install-OrbitXboxMode.bat'
$certificateMetadataPath = Join-Path $repoRoot '.certificates\orbit-development.json'
$inspectionDir = Join-Path $releaseDir '_orbit-xbox-inspection'
$readmePath = Join-Path $releaseDir 'XBOX-MODE-README.txt'
$certificate = $null

if (!(Test-Path -LiteralPath $packagePath)) { throw "Missing Xbox Mode package: $packagePath" }
if (!(Test-Path -LiteralPath $installerPath)) { throw "Missing one-click Xbox Mode setup: $installerPath" }
if (!(Test-Path -LiteralPath $certificatePath)) { throw "Missing public Xbox Mode certificate: $certificatePath" }
if (!(Test-Path -LiteralPath $installScriptPath)) { throw "Missing fallback Xbox Mode installer: $installScriptPath" }
if (!(Test-Path -LiteralPath $installBatchPath)) { throw "Missing fallback Xbox Mode launcher: $installBatchPath" }
if (!(Test-Path -LiteralPath $certificateMetadataPath)) { throw "Missing certificate metadata: $certificateMetadataPath" }

$resolvedRelease = [System.IO.Path]::GetFullPath($releaseDir).TrimEnd('\') + '\'
$resolvedInspection = [System.IO.Path]::GetFullPath($inspectionDir)
if (!$resolvedInspection.StartsWith($resolvedRelease, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Unsafe inspection directory.'
}
if (Test-Path -LiteralPath $inspectionDir) { Remove-Item -LiteralPath $inspectionDir -Recurse -Force }

try {
  $certificateMetadata = Get-Content -LiteralPath $certificateMetadataPath -Raw | ConvertFrom-Json
  $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath)
  if (
    $certificate.Subject -ne 'CN=ORBIT Development' -or
    $certificate.Issuer -ne 'CN=ORBIT Development' -or
    $certificate.HasPrivateKey -or
    $certificate.Thumbprint -ne $certificateMetadata.thumbprint -or
    $certificate.NotAfter -le (Get-Date).AddDays(30)
  ) {
    throw 'The public ORBIT certificate failed its identity, lifetime, or private-key checks.'
  }

  $signature = Get-AuthenticodeSignature -FilePath $packagePath
  if (!$signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $certificateMetadata.thumbprint) {
    throw 'The package signer does not match the ORBIT development certificate.'
  }
  if ($signature.Status -ne 'Valid') {
    throw "Invalid AppX signature: $($signature.Status) - $($signature.StatusMessage)"
  }

  $installerSignature = Get-AuthenticodeSignature -FilePath $installerPath
  if (!$installerSignature.SignerCertificate -or $installerSignature.SignerCertificate.Thumbprint -ne $certificateMetadata.thumbprint) {
    throw 'The one-click setup signer does not match the ORBIT development certificate.'
  }
  if ($installerSignature.Status -ne 'Valid') {
    throw "Invalid setup signature: $($installerSignature.Status) - $($installerSignature.StatusMessage)"
  }

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
  $namespaceManager.AddNamespace('rescap', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities')

  $packageIdentity = $manifest.SelectSingleNode('/f:Package/f:Identity', $namespaceManager)
  if (
    $packageIdentity.Name -ne 'ORBIT.GamingHome' -or
    $packageIdentity.Publisher -ne 'CN=ORBIT Development' -or
    $packageIdentity.ProcessorArchitecture -ne 'x64' -or
    $packageIdentity.Version -ne $xboxPackageVersion
  ) {
    throw "Unexpected package identity contract: $($packageIdentity.Name) $($packageIdentity.Publisher) $($packageIdentity.ProcessorArchitecture) $($packageIdentity.Version)"
  }
  $universalFamily = $manifest.SelectSingleNode("/f:Package/f:Dependencies/f:TargetDeviceFamily[@Name='Windows.Universal']", $namespaceManager)
  $desktopFamily = $manifest.SelectSingleNode("/f:Package/f:Dependencies/f:TargetDeviceFamily[@Name='Windows.Desktop']", $namespaceManager)
  if (!$universalFamily -or !$desktopFamily) { throw 'The package must target both Windows.Universal and Windows.Desktop for handheld compatibility.' }
  foreach ($family in @($universalFamily, $desktopFamily)) {
    if ([version]$family.MinVersion -ne $xboxMinimumWindowsVersion) {
      throw "Unexpected Xbox Mode minimum Windows version for $($family.Name): $($family.MinVersion)"
    }
    if ([version]$family.MaxVersionTested -lt [version]$family.MinVersion) {
      throw "MaxVersionTested precedes MinVersion for $($family.Name)."
    }
  }
  $application = $manifest.SelectSingleNode("/f:Package/f:Applications/f:Application[@Id='ORBIT']", $namespaceManager)
  if (!$application -or $application.Executable -ne 'app\ORBIT.exe' -or $application.EntryPoint -ne 'Windows.FullTrustApplication') {
    throw 'The ORBIT full-trust application declaration is invalid.'
  }
  $runFullTrust = $manifest.SelectSingleNode("//rescap:Capability[@Name='runFullTrust']", $namespaceManager)
  $gamingExtension = $manifest.SelectSingleNode("//uap3:AppExtension[@Name='windows.gamingApp']", $namespaceManager)
  $gamingCapability = $manifest.SelectSingleNode("//uap4:CustomCapability[@Name='Microsoft.appCategory.gamingHome_8wekyb3d8bbwe']", $namespaceManager)
  if (!$runFullTrust -or !$gamingExtension -or !$gamingCapability) { throw 'The full-trust or Xbox Gaming Home declaration is missing.' }

  foreach ($requiredPath in @(
    (Join-Path $inspectionDir 'CustomCapability.SCCD'),
    (Join-Path $inspectionDir 'Public\registration.json'),
    (Join-Path $inspectionDir 'app\ORBIT.exe'),
    (Join-Path $inspectionDir 'app\resources\release-manifest.json')
  )) {
    if (!(Test-Path -LiteralPath $requiredPath)) { throw "Package is missing: $requiredPath" }
  }

  $packagedRelease = Get-Content -LiteralPath (Join-Path $inspectionDir 'app\resources\release-manifest.json') -Raw | ConvertFrom-Json
  if (
    $packagedRelease.displayVersion -ne $displayVersion -or
    !$packagedRelease.xboxMode.enabled -or
    $packagedRelease.xboxPackageVersion -ne $xboxPackageVersion -or
    $packagedRelease.xboxMode.minimumWindowsVersion -ne $xboxMinimumWindowsVersion.ToString() -or
    $packagedRelease.xboxMode.packageIdentity -ne 'ORBIT.GamingHome' -or
    $packagedRelease.xboxMode.applicationId -ne 'ORBIT' -or
    $packagedRelease.xboxMode.appExtension -ne 'windows.gamingApp' -or
    $packagedRelease.xboxMode.customCapability -ne 'Microsoft.appCategory.gamingHome_8wekyb3d8bbwe'
  ) {
    throw "The packaged release manifest does not describe Xbox Mode beta $displayVersion."
  }

  $registration = Get-Content -LiteralPath (Join-Path $inspectionDir 'Public\registration.json') -Raw | ConvertFrom-Json
  if (
    [int]$registration.schemaVersion -ne 1 -or
    $registration.product -ne 'ORBIT' -or
    $registration.role -ne 'gaming-home' -or
    $registration.applicationId -ne 'ORBIT' -or
    $registration.version -ne $xboxPackageVersion
  ) {
    throw 'The Gaming Home registration metadata does not match the package identity.'
  }

  [xml]$sccd = Get-Content -LiteralPath (Join-Path $inspectionDir 'CustomCapability.SCCD') -Raw
  $sccdNamespace = [System.Xml.XmlNamespaceManager]::new($sccd.NameTable)
  $sccdNamespace.AddNamespace('s', 'http://schemas.microsoft.com/appx/2018/sccd')
  $sccdCapability = $sccd.SelectSingleNode("/s:CustomCapabilityDescriptor/s:CustomCapabilities/s:CustomCapability[@Name='Microsoft.appCategory.gamingHome_8wekyb3d8bbwe']", $sccdNamespace)
  $sccdAuthorizedEntities = $sccd.SelectSingleNode('/s:CustomCapabilityDescriptor/s:AuthorizedEntities', $sccdNamespace)
  if (!$sccdCapability -or !$sccdAuthorizedEntities -or $sccdAuthorizedEntities.AllowAny -ne 'true') {
    throw 'The Xbox beta custom-capability descriptor is invalid.'
  }

  & $installScriptPath -PackagePath $packagePath -CertificatePath $certificatePath -ValidateOnly

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
      },
      [ordered]@{
        role = 'public-certificate'
        file = (Get-Item -LiteralPath $certificatePath).Name
        size = (Get-Item -LiteralPath $certificatePath).Length
        sha256 = (Get-FileHash -LiteralPath $certificatePath -Algorithm SHA256).Hash.ToLowerInvariant()
        subject = $certificate.Subject
        thumbprint = $certificate.Thumbprint
        notAfterUtc = $certificate.NotAfter.ToUniversalTime().ToString('o')
      },
      [ordered]@{
        role = 'fallback-installer'
        file = (Get-Item -LiteralPath $installScriptPath).Name
        size = (Get-Item -LiteralPath $installScriptPath).Length
        sha256 = (Get-FileHash -LiteralPath $installScriptPath -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    )
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $releaseDir 'xbox-distribution-manifest.json') -Encoding UTF8

  @"
ORBIT $displayVersion - Xbox Mode beta

Recommended: run ORBIT-Beta-XboxMode-Setup-$displayVersion-x64.exe. It is a self-contained installer.

ZIP fallback:
1. Keep all files from the ZIP in the same folder.
2. Double-click Install-OrbitXboxMode.bat.
3. Approve the administrator prompt. The installer adds the certificate only to LocalMachine\TrustedPeople,
   enables Developer Mode for the SCCD capability, and installs the AppX package.
4. The installer opens Settings > Gaming > Xbox mode. Under Choose home app, select ORBIT.

Requirements: Windows 11 version 24H2 (build 10.0.26100.0) or newer. Xbox Mode availability still depends
on Microsoft's supported markets, device policy, and phased Windows feature rollout. ORBIT deliberately does
not hard-code an Xbox app version or write the selected Gaming Home app directly.
This community beta is signed with the self-signed ORBIT certificate. Verify its thumbprint before trusting it.
Expected certificate thumbprint: $($certificate.Thumbprint)
"@ | Set-Content -LiteralPath $readmePath -Encoding UTF8

  @(
    $installerPath,
    $packagePath,
    $certificatePath,
    $installScriptPath,
    $installBatchPath,
    $readmePath,
    (Join-Path $releaseDir 'xbox-distribution-manifest.json')
  ) | ForEach-Object {
    $hashFile = Get-Item -LiteralPath $_
    "$((Get-FileHash -LiteralPath $hashFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $($hashFile.Name)"
  } | Set-Content -LiteralPath (Join-Path $releaseDir 'XBOX-SHA256SUMS.txt') -Encoding ASCII

  Write-Host "Xbox Mode artifacts verified: $($file.Name), $($installerFile.Name)"
} finally {
  if ($certificate) { $certificate.Dispose() }
  if (Test-Path -LiteralPath $inspectionDir) { Remove-Item -LiteralPath $inspectionDir -Recurse -Force }
}
