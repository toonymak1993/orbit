[CmdletBinding()]
param(
  [string]$PackagePath,
  [string]$CertificatePath,
  [switch]$Launch,
  [switch]$OpenSettings,
  [switch]$ValidateOnly,
  [switch]$UpdateOnly,
  [string]$InvokingUserSid
)

$installerCulture = [System.Globalization.CultureInfo]::GetCultureInfo('en-US')
[System.Globalization.CultureInfo]::DefaultThreadCurrentCulture = $installerCulture
[System.Globalization.CultureInfo]::DefaultThreadCurrentUICulture = $installerCulture
[System.Threading.Thread]::CurrentThread.CurrentCulture = $installerCulture
[System.Threading.Thread]::CurrentThread.CurrentUICulture = $installerCulture

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedPackageIdentity = 'ORBIT.GamingHome'
$expectedApplicationId = 'ORBIT'
$expectedPublisher = 'CN=Open Source Developer Luis Antonio Garcia Roque, O=Open Source Developer, L=Alfdorf, S=Baden-Württemberg, C=DE'
$expectedIssuer = 'CN=Certum Code Signing 2021 CA, O=Asseco Data Systems S.A., C=PL'
$expectedSignerThumbprint = '61E90C0AACBF2F407A575903FCC197F45B61706D'
$legacyPublisher = 'CN=ORBIT Development'
$expectedGamingExtension = 'windows.gamingApp'
$expectedGamingCapability = 'Microsoft.appCategory.gamingHome_8wekyb3d8bbwe'
$minimumXboxModeVersion = [version]'10.0.26100.0'
$diagnosticDirectory = if ($UpdateOnly) {
  Join-Path $env:LOCALAPPDATA 'ORBIT\Logs'
} else {
  Join-Path $env:ProgramData 'ORBIT\Logs'
}
$diagnosticPath = Join-Path $diagnosticDirectory $(if ($UpdateOnly) { 'xbox-mode-update-diagnostics.json' } else { 'xbox-mode-diagnostics.json' })

function Get-DefaultXboxPackagePath {
  $candidates = @(
    Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'ORBIT-XboxMode-*-x64.appx' -File -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'ORBIT-Beta-XboxMode-*-x64.appx' -File -ErrorAction SilentlyContinue
  )
  if ($candidates.Count -ne 1) {
    throw "Expected exactly one ORBIT Xbox Mode AppX next to this script, found $($candidates.Count)."
  }
  return $candidates[0].FullName
}

function Resolve-RequiredFile {
  param(
    [string]$Path,
    [string]$Description,
    [string]$ExpectedExtension
  )

  if ([string]::IsNullOrWhiteSpace($Path)) { throw "$Description path is empty." }
  $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
  $file = Get-Item -LiteralPath $resolved -ErrorAction Stop
  if (!$file.PSIsContainer -and $file.Extension -ieq $ExpectedExtension) { return $file.FullName }
  throw "$Description must be a $ExpectedExtension file: $resolved"
}

function Get-OptionalRegistryProperty {
  param(
    [string]$Path,
    [string]$Name
  )

  $item = Get-ItemProperty -LiteralPath $Path -ErrorAction SilentlyContinue
  if (!$item) { return $null }
  return $item.PSObject.Properties[$Name]
}

function Get-WindowsBuildInfo {
  $currentVersion = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  $buildText = [string]$currentVersion.CurrentBuildNumber
  if ([string]::IsNullOrWhiteSpace($buildText)) { $buildText = [string]$currentVersion.CurrentBuild }
  $build = 0
  if (![int]::TryParse($buildText, [ref]$build)) { throw "Windows reported an invalid build number: $buildText" }

  $ubr = 0
  $ubrProperty = $currentVersion.PSObject.Properties['UBR']
  if ($ubrProperty -and $null -ne $ubrProperty.Value) {
    $ubrText = [string]$ubrProperty.Value
    if (![int]::TryParse($ubrText, [ref]$ubr)) { throw "Windows reported an invalid UBR revision: $ubrText" }
  }

  return [pscustomobject]@{
    Build = $build
    Ubr = $ubr
    Version = [version]"10.0.$build.$ubr"
    DisplayVersion = [string]$currentVersion.DisplayVersion
    Edition = [string]$currentVersion.EditionID
    InstallationType = [string]$currentVersion.InstallationType
  }
}

function Read-ZipEntryText {
  param(
    [System.IO.Compression.ZipArchiveEntry]$Entry
  )

  if ($Entry.Length -gt 1MB) { throw "The AppX metadata entry is unexpectedly large: $($Entry.FullName)" }
  $entryStream = $Entry.Open()
  $reader = $null
  try {
    $reader = [System.IO.StreamReader]::new($entryStream, [System.Text.Encoding]::UTF8, $true)
    return $reader.ReadToEnd()
  } finally {
    if ($reader) { $reader.Dispose() } else { $entryStream.Dispose() }
  }
}

function ConvertTo-SafeXml {
  param([string]$Content)

  $settings = [System.Xml.XmlReaderSettings]::new()
  $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $stringReader = [System.IO.StringReader]::new($Content)
  $xmlReader = $null
  try {
    $xmlReader = [System.Xml.XmlReader]::Create($stringReader, $settings)
    $document = [System.Xml.XmlDocument]::new()
    $document.XmlResolver = $null
    $document.Load($xmlReader)
    return $document
  } finally {
    if ($xmlReader) { $xmlReader.Dispose() }
    $stringReader.Dispose()
  }
}

function Assert-OrbitManifestContract {
  param([System.Xml.XmlDocument]$Manifest)

  $namespaceManager = [System.Xml.XmlNamespaceManager]::new($Manifest.NameTable)
  $namespaceManager.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
  $namespaceManager.AddNamespace('uap3', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/3')
  $namespaceManager.AddNamespace('uap4', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/4')
  $namespaceManager.AddNamespace('rescap', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities')

  $identity = $Manifest.SelectSingleNode('/f:Package/f:Identity', $namespaceManager)
  if (!$identity) { throw 'The AppX manifest has no package identity.' }
  if ($identity.GetAttribute('Name') -ne $expectedPackageIdentity) {
    throw "Unexpected AppX identity: $($identity.GetAttribute('Name'))"
  }
  if ($identity.GetAttribute('Publisher') -ne $expectedPublisher) {
    throw "Unexpected AppX publisher: $($identity.GetAttribute('Publisher'))"
  }
  if ($identity.GetAttribute('ProcessorArchitecture') -ne 'x64') {
    throw "Unexpected AppX architecture: $($identity.GetAttribute('ProcessorArchitecture'))"
  }

  $packageVersion = [version]$identity.GetAttribute('Version')
  $application = $Manifest.SelectSingleNode("/f:Package/f:Applications/f:Application[@Id='$expectedApplicationId']", $namespaceManager)
  if (!$application -or $application.GetAttribute('Executable') -ne 'app\ORBIT.exe' -or $application.GetAttribute('EntryPoint') -ne 'Windows.FullTrustApplication') {
    throw 'The AppX does not contain the expected ORBIT full-trust application contract.'
  }

  $runFullTrust = $Manifest.SelectSingleNode("//rescap:Capability[@Name='runFullTrust']", $namespaceManager)
  $gamingExtension = $Manifest.SelectSingleNode("//uap3:AppExtension[@Name='$expectedGamingExtension']", $namespaceManager)
  $gamingCapability = $Manifest.SelectSingleNode("//uap4:CustomCapability[@Name='$expectedGamingCapability']", $namespaceManager)
  if (!$runFullTrust -or !$gamingExtension -or !$gamingCapability) {
    throw 'The AppX is missing its full-trust, Gaming Home extension, or Gaming Home capability contract.'
  }

  $minimumVersions = @()
  foreach ($familyName in @('Windows.Universal', 'Windows.Desktop')) {
    $family = $Manifest.SelectSingleNode("/f:Package/f:Dependencies/f:TargetDeviceFamily[@Name='$familyName']", $namespaceManager)
    if (!$family) { throw "The AppX does not target $familyName." }
    $minimumVersions += [version]$family.GetAttribute('MinVersion')
  }

  return [pscustomobject]@{
    Identity = $identity.GetAttribute('Name')
    Publisher = $identity.GetAttribute('Publisher')
    Version = $packageVersion
    Architecture = $identity.GetAttribute('ProcessorArchitecture')
    MinimumWindowsVersion = ($minimumVersions | Sort-Object -Descending | Select-Object -First 1)
  }
}

function Get-OrbitPackageContract {
  param([string]$Path)

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $fileStream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  $archive = $null
  try {
    $archive = [System.IO.Compression.ZipArchive]::new($fileStream, [System.IO.Compression.ZipArchiveMode]::Read, $false)
    $entries = @{}
    foreach ($entry in $archive.Entries) {
      $entries[$entry.FullName.Replace('\', '/').ToLowerInvariant()] = $entry
    }

    foreach ($requiredEntry in @(
      'AppxManifest.xml',
      'AppxSignature.p7x',
      'CustomCapability.SCCD',
      'Public/registration.json',
      'app/ORBIT.exe',
      'app/resources/release-manifest.json'
    )) {
      if (!$entries.ContainsKey($requiredEntry.ToLowerInvariant())) {
        throw "The AppX package is missing $requiredEntry."
      }
    }

    $manifest = ConvertTo-SafeXml (Read-ZipEntryText $entries['appxmanifest.xml'])
    $contract = Assert-OrbitManifestContract $manifest

    $registration = Read-ZipEntryText $entries['public/registration.json'] | ConvertFrom-Json
    if (
      [int]$registration.schemaVersion -ne 1 -or
      [string]$registration.product -ne 'ORBIT' -or
      [string]$registration.role -ne 'gaming-home' -or
      [string]$registration.applicationId -ne $expectedApplicationId -or
      [version]$registration.version -ne $contract.Version
    ) {
      throw 'The Gaming Home registration metadata does not match the AppX identity.'
    }

    $release = Read-ZipEntryText $entries['app/resources/release-manifest.json'] | ConvertFrom-Json
    if (
      !$release.xboxMode.enabled -or
      [string]$release.xboxMode.packageIdentity -ne $expectedPackageIdentity -or
      [string]$release.xboxMode.applicationId -ne $expectedApplicationId -or
      [string]$release.xboxMode.appExtension -ne $expectedGamingExtension -or
      [string]$release.xboxMode.customCapability -ne $expectedGamingCapability -or
      [version]$release.xboxPackageVersion -ne $contract.Version
    ) {
      throw 'The packaged release metadata does not match the Gaming Home contract.'
    }

    $sccd = ConvertTo-SafeXml (Read-ZipEntryText $entries['customcapability.sccd'])
    $sccdNamespace = [System.Xml.XmlNamespaceManager]::new($sccd.NameTable)
    $sccdNamespace.AddNamespace('s', 'http://schemas.microsoft.com/appx/2018/sccd')
    $sccdCapability = $sccd.SelectSingleNode("/s:CustomCapabilityDescriptor/s:CustomCapabilities/s:CustomCapability[@Name='$expectedGamingCapability']", $sccdNamespace)
    $authorizedEntities = $sccd.SelectSingleNode('/s:CustomCapabilityDescriptor/s:AuthorizedEntities', $sccdNamespace)
    if (!$sccdCapability -or !$authorizedEntities -or $authorizedEntities.GetAttribute('AllowAny') -ne 'true') {
      throw 'The AppX does not contain the expected Xbox Mode custom-capability descriptor.'
    }

    return $contract
  } finally {
    if ($archive) { $archive.Dispose() } else { $fileStream.Dispose() }
  }
}

function Assert-OrbitCertificate {
  param([System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate)

  $now = Get-Date
  if (
    $Certificate.Subject -ne $expectedPublisher -or
    $Certificate.Issuer -ne $expectedIssuer -or
    $Certificate.Thumbprint -ne $expectedSignerThumbprint
  ) {
    throw "Unexpected certificate identity: $($Certificate.Subject)"
  }
  if ($Certificate.HasPrivateKey) { throw 'The public installer must not contain an ORBIT private key.' }
  if ($Certificate.NotBefore -gt $now.AddMinutes(5) -or $Certificate.NotAfter -le $now.AddDays(30)) {
    throw "The ORBIT certificate is not valid for a safe installation window: $($Certificate.NotBefore) - $($Certificate.NotAfter)"
  }

  $hasCodeSigningUsage = $false
  $hasDigitalSignatureUsage = $false
  $enhancedKeyUsageCount = 0
  $keyUsageFlags = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::None
  foreach ($extension in $Certificate.Extensions) {
    if ($extension -is [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]) {
      $enhancedKeyUsageCount = $extension.EnhancedKeyUsages.Count
      foreach ($usage in $extension.EnhancedKeyUsages) {
        if ($usage.Value -eq '1.3.6.1.5.5.7.3.3') { $hasCodeSigningUsage = $true }
      }
    }
    if ($extension -is [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]) {
      $keyUsageFlags = $extension.KeyUsages
      $hasDigitalSignatureUsage = $keyUsageFlags -eq [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature
    }
  }
  if (!$hasCodeSigningUsage -or $enhancedKeyUsageCount -ne 1 -or !$hasDigitalSignatureUsage) {
    throw 'The ORBIT certificate is not restricted to a valid code-signing usage.'
  }
}

function Assert-PackageSignature {
  param(
    [string]$Path,
    [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
    [switch]$RequireTrusted
  )

  $signature = Get-AuthenticodeSignature -FilePath $Path
  if (!$signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $Certificate.Thumbprint) {
    throw 'The AppX package is not signed by the supplied ORBIT certificate.'
  }
  if ($signature.Status -ne 'Valid') {
    throw "The AppX signature is invalid: $($signature.Status) - $($signature.StatusMessage)"
  }
  return $signature
}

function Get-OrbitPackageByPublisher {
  param([Parameter(Mandatory = $true)][string]$Publisher)

  return @(
    Get-AppxPackage -Name $expectedPackageIdentity -ErrorAction SilentlyContinue |
      Where-Object { $_.Publisher -eq $Publisher } |
      Sort-Object Version -Descending
  ) | Select-Object -First 1
}

function Get-InstalledOrbitPackage {
  return Get-OrbitPackageByPublisher -Publisher $expectedPublisher
}

function Get-LegacyOrbitPackage {
  return Get-OrbitPackageByPublisher -Publisher $legacyPublisher
}

function Assert-InstalledOrbitPackage {
  param(
    $Package,
    [version]$ExpectedVersion
  )

  if (!$Package) { throw 'ORBIT was installed, but its package identity could not be found for the current Windows user.' }
  if ([version]$Package.Version -ne $ExpectedVersion) {
    throw "Windows registered ORBIT version $($Package.Version), but the installer expected $ExpectedVersion."
  }
  $manifestPath = Join-Path $Package.InstallLocation 'AppxManifest.xml'
  $manifest = ConvertTo-SafeXml (Get-Content -LiteralPath $manifestPath -Raw)
  $contract = Assert-OrbitManifestContract $manifest
  foreach ($requiredPath in @(
    (Join-Path $Package.InstallLocation 'app\ORBIT.exe'),
    (Join-Path $Package.InstallLocation 'Public\registration.json'),
    (Join-Path $Package.InstallLocation 'CustomCapability.SCCD')
  )) {
    if (!(Test-Path -LiteralPath $requiredPath)) { throw "The installed ORBIT package is incomplete: $requiredPath" }
  }
  return $contract
}

function Get-OptionalPackageInfo {
  param([string]$Name)

  $package = Get-AppxPackage -Name $Name -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
  if (!$package) { return $null }
  return [ordered]@{
    version = $package.Version.ToString()
    architecture = $package.Architecture.ToString()
    status = $package.Status.ToString()
  }
}

function Write-InstallDiagnostics {
  param([System.Collections.IDictionary]$Diagnostics)

  New-Item -ItemType Directory -Force -Path $diagnosticDirectory | Out-Null
  $temporaryPath = "$diagnosticPath.tmp"
  $Diagnostics | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
  Move-Item -LiteralPath $temporaryPath -Destination $diagnosticPath -Force
}

if ([string]::IsNullOrWhiteSpace($PackagePath)) { $PackagePath = Get-DefaultXboxPackagePath }
if ([string]::IsNullOrWhiteSpace($CertificatePath)) { $CertificatePath = Join-Path $PSScriptRoot 'ORBIT-Code-Signing.cer' }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$currentUserSid = $identity.User.Value

if (!$ValidateOnly -and !$UpdateOnly -and !$isAdministrator) {
  $arguments = @(
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"{0}"' -f $PSCommandPath),
    '-PackagePath', ('"{0}"' -f ([System.IO.Path]::GetFullPath($PackagePath))),
    '-CertificatePath', ('"{0}"' -f ([System.IO.Path]::GetFullPath($CertificatePath))),
    '-InvokingUserSid', $currentUserSid
  )
  if ($Launch) { $arguments += '-Launch' }
  if ($OpenSettings) { $arguments += '-OpenSettings' }
  $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "The elevated Xbox Mode installer failed with exit code $($process.ExitCode)." }
  return
}

$diagnostics = [ordered]@{
  schemaVersion = 3
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  installerLanguage = [System.Threading.Thread]::CurrentThread.CurrentUICulture.Name
  mode = if ($UpdateOnly) { 'update' } elseif ($ValidateOnly) { 'validation' } else { 'install' }
  result = 'pending'
  phase = 'initialization'
}
$certificate = $null
$developerModeChanged = $false
$developerModePropertyExisted = $false
$developerModeOriginalValue = $null
$packageDeploymentCompleted = $false
$packageRollbackCompleted = $false
$developerModeRollbackCompleted = $false
$existingPackage = $null
$legacyPackage = $null

try {
  if (!$ValidateOnly -and ![string]::IsNullOrWhiteSpace($InvokingUserSid) -and $InvokingUserSid -ne $currentUserSid) {
    throw 'Administrator approval used a different Windows account. Sign in with the account that should own ORBIT and run setup from an administrator-capable account.'
  }

  $diagnostics.phase = 'input-validation'
  $resolvedPackage = Resolve-RequiredFile $PackagePath 'ORBIT package' '.appx'
  $resolvedCertificate = Resolve-RequiredFile $CertificatePath 'ORBIT certificate' '.cer'
  $windows = Get-WindowsBuildInfo
  if ($windows.InstallationType -ne 'Client') { throw "Xbox Mode requires Windows client; this installation reports $($windows.InstallationType)." }
  if (![Environment]::Is64BitOperatingSystem) { throw 'ORBIT Xbox Mode requires 64-bit Windows.' }
  if ($windows.Version -lt $minimumXboxModeVersion) {
    throw "Xbox Mode requires Windows 11 version 24H2 (build $minimumXboxModeVersion) or newer. This PC reports $($windows.Version)."
  }

  $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($resolvedCertificate)
  Assert-OrbitCertificate $certificate
  $signature = Assert-PackageSignature $resolvedPackage $certificate
  $packageContract = Get-OrbitPackageContract $resolvedPackage
  if ($windows.Version -lt $packageContract.MinimumWindowsVersion) {
    throw "This AppX requires Windows $($packageContract.MinimumWindowsVersion) or newer. This PC reports $($windows.Version)."
  }
  $packageHash = (Get-FileHash -LiteralPath $resolvedPackage -Algorithm SHA256).Hash.ToLowerInvariant()
  $certificateSha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $certificateHash = [BitConverter]::ToString($certificateSha256.ComputeHash($certificate.RawData)).Replace('-', '').ToLowerInvariant()
  } finally {
    $certificateSha256.Dispose()
  }

  $diagnostics.windows = [ordered]@{
    displayVersion = $windows.DisplayVersion
    build = "$($windows.Build).$($windows.Ubr)"
    edition = $windows.Edition
    installationType = $windows.InstallationType
    is64Bit = [Environment]::Is64BitOperatingSystem
  }
  $diagnostics.package = [ordered]@{
    file = [System.IO.Path]::GetFileName($resolvedPackage)
    sha256 = $packageHash
    identity = $packageContract.Identity
    version = $packageContract.Version.ToString()
    architecture = $packageContract.Architecture
    minimumWindowsVersion = $packageContract.MinimumWindowsVersion.ToString()
    signatureStatus = $signature.Status.ToString()
    signerThumbprint = $certificate.Thumbprint
    certificateSha256 = $certificateHash
    certificateNotAfterUtc = $certificate.NotAfter.ToUniversalTime().ToString('o')
  }

  Write-Host "Windows $($windows.DisplayVersion), build $($windows.Build).$($windows.Ubr) satisfies the Windows 11 24H2 Xbox Mode baseline."
  Write-Host "Validated ORBIT Xbox Mode package $($packageContract.Version), SHA-256 $packageHash"

  if ($ValidateOnly) {
    Write-Host 'Validation-only check passed. No certificate, registry, package, launch, or Settings changes were made.'
    return
  }

  $diagnostics.phase = 'prerequisite-detection'
  $gamingApp = Get-OptionalPackageInfo 'Microsoft.GamingApp'
  $gameBar = Get-OptionalPackageInfo 'Microsoft.XboxGamingOverlay'
  if (!$gamingApp) { Write-Warning 'Microsoft Xbox app is missing. Install or update it from Microsoft Store before entering Xbox Mode.' }
  if (!$gameBar) { Write-Warning 'Xbox Game Bar is missing. Install or update it from Microsoft Store before entering Xbox Mode.' }

  $gamingConfigurationKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GamingConfiguration'
  $gamingConfigurationPresent = Test-Path -LiteralPath $gamingConfigurationKey
  $gamingHomeProperty = Get-OptionalRegistryProperty -Path $gamingConfigurationKey -Name GamingHomeApp
  $currentGamingHome = if ($null -ne $gamingHomeProperty) { [string]$gamingHomeProperty.Value } else { '' }
  $policyKey = 'HKLM:\SOFTWARE\Microsoft\PolicyManager\current\device\Games'
  $xboxModePolicyProperty = Get-OptionalRegistryProperty -Path $policyKey -Name DisableGamingFullScreenExperience
  $xboxModePolicyValue = if ($null -ne $xboxModePolicyProperty) { $xboxModePolicyProperty.Value } else { $null }
  $xboxModeDisabledByPolicy = $null -ne $xboxModePolicyValue -and [int]$xboxModePolicyValue -ne 0
  if ($xboxModeDisabledByPolicy) {
    Write-Warning 'Xbox Mode is disabled by Windows device policy. ORBIT can be installed, but the mode remains unavailable until the administrator changes that policy.'
  }

  $existingPackage = Get-InstalledOrbitPackage
  $legacyPackage = Get-LegacyOrbitPackage
  if ($UpdateOnly -and !$existingPackage) {
    throw 'ORBIT Xbox Mode is not installed for this Windows account. The update-only installer refuses to create a new installation.'
  }
  if ($existingPackage -and [version]$existingPackage.Version -gt $packageContract.Version) {
    throw "A newer ORBIT Xbox Mode package ($($existingPackage.Version)) is already installed. Setup refuses to downgrade it to $($packageContract.Version)."
  }

  $diagnostics.prerequisites = [ordered]@{
    xboxApp = $gamingApp
    gameBar = $gameBar
    gamingConfigurationPresent = $gamingConfigurationPresent
    gamingHomeValuePresent = $null -ne $gamingHomeProperty
    xboxModePolicyValuePresent = $null -ne $xboxModePolicyProperty
    xboxModeDisabledByPolicy = $xboxModeDisabledByPolicy
    developerModeInitiallyEnabled = $false
  }
  $diagnostics.previousInstallation = if ($existingPackage) {
    [ordered]@{
      version = $existingPackage.Version.ToString()
      packageFamilyName = $existingPackage.PackageFamilyName
    }
  } else { $null }
  $diagnostics.legacyInstallation = if ($legacyPackage) {
    [ordered]@{
      version = $legacyPackage.Version.ToString()
      packageFamilyName = $legacyPackage.PackageFamilyName
      publisher = $legacyPackage.Publisher
    }
  } else { $null }

  $diagnostics.phase = 'machine-preparation'
  $trustedSignature = Assert-PackageSignature $resolvedPackage $certificate -RequireTrusted
  $diagnostics.package.publicTrustStatus = $trustedSignature.Status.ToString()

  $developerModeKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
  $developerModeState = Get-ItemProperty -LiteralPath $developerModeKey -ErrorAction SilentlyContinue
  $developerModeProperty = if ($developerModeState) { $developerModeState.PSObject.Properties['AllowDevelopmentWithoutDevLicense'] } else { $null }
  $developerModePropertyExisted = $null -ne $developerModeProperty
  if ($developerModePropertyExisted) { $developerModeOriginalValue = [int]$developerModeProperty.Value }
  $diagnostics.prerequisites.developerModeInitiallyEnabled = $developerModePropertyExisted -and $developerModeOriginalValue -eq 1

  if ($UpdateOnly -and (!$developerModePropertyExisted -or $developerModeOriginalValue -ne 1)) {
    throw 'Windows Developer Mode is no longer enabled. Update-only mode will not change machine policy.'
  }
  if (!$UpdateOnly -and (!$developerModePropertyExisted -or $developerModeOriginalValue -ne 1)) {
    Write-Host 'Enabling Windows Developer Mode for the Gaming Home capability...'
    if (!(Test-Path -LiteralPath $developerModeKey)) { New-Item -Path $developerModeKey -Force | Out-Null }
    New-ItemProperty -Path $developerModeKey -Name AllowDevelopmentWithoutDevLicense -PropertyType DWord -Value 1 -Force | Out-Null
    $developerModeChanged = $true
  }

  $diagnostics.phase = 'package-deployment'
  if ($existingPackage -and [version]$existingPackage.Version -eq $packageContract.Version) {
    Write-Host "ORBIT Xbox Mode package $($packageContract.Version) is already installed; verifying the existing registration without replacing it."
    $installedPackage = $existingPackage
    $installationAction = 'already-current'
  } else {
    $installationAction = if ($existingPackage) { 'upgrade' } else { 'install' }
    Write-Host "$($installationAction.Substring(0, 1).ToUpperInvariant())$($installationAction.Substring(1))ing the ORBIT Xbox Mode package..."
    $deploymentHash = (Get-FileHash -LiteralPath $resolvedPackage -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($deploymentHash -cne $packageHash) { throw 'The AppX package changed after validation; setup refuses to deploy it.' }
    Add-AppxPackage -Path $resolvedPackage -ForceApplicationShutdown
    $packageDeploymentCompleted = $true
    $installedPackage = Get-InstalledOrbitPackage
  }

  $diagnostics.phase = 'post-install-validation'
  $null = Assert-InstalledOrbitPackage $installedPackage $packageContract.Version
  $orbitAumid = "$($installedPackage.PackageFamilyName)!$expectedApplicationId"
  $gamingHomeProperty = Get-OptionalRegistryProperty -Path $gamingConfigurationKey -Name GamingHomeApp
  $currentGamingHome = if ($null -ne $gamingHomeProperty) { [string]$gamingHomeProperty.Value } else { '' }
  $diagnostics.installed = [ordered]@{
    action = $installationAction
    version = $installedPackage.Version.ToString()
    packageFamilyName = $installedPackage.PackageFamilyName
    aumid = $orbitAumid
    configuredGamingHome = $currentGamingHome
    orbitIsConfiguredGamingHome = $currentGamingHome -eq $orbitAumid
  }

  if ($legacyPackage) {
    $diagnostics.phase = 'legacy-publisher-transition'
    $diagnostics.legacyMigration = [ordered]@{
      automaticRemovalAttempted = $false
      legacyPackageRetained = $true
      previousPackageFamilyName = $legacyPackage.PackageFamilyName
      reason = 'Windows does not support PreserveApplicationData for packaged AppX removals. The legacy package remains registered to avoid deleting its package-family-scoped data.'
    }
    Write-Warning 'The legacy self-signed ORBIT package remains installed so Windows does not delete its package-family-scoped data. Select the new ORBIT entry in Xbox Mode settings; do not remove the legacy package until you have confirmed your data in the Certum-signed build.'
  }

  $diagnostics.result = 'success'
  $diagnostics.phase = 'complete'
  $diagnostics.completedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  try { Write-InstallDiagnostics $diagnostics } catch { Write-Warning "ORBIT is installed, but diagnostics could not be written: $($_.Exception.Message)" }

  Write-Host "ORBIT Xbox Mode package ready: $($installedPackage.Version)"
  Write-Host "ORBIT Gaming Home ID: $orbitAumid"
  if ($currentGamingHome -eq $orbitAumid) {
    Write-Host 'ORBIT is already configured as the Windows Gaming Home app.'
  } elseif ([string]::IsNullOrWhiteSpace($currentGamingHome)) {
    Write-Warning 'No Gaming Home app is selected yet. Select ORBIT in Settings > Gaming > Xbox mode.'
  } else {
    Write-Warning "Another Gaming Home app is selected: $currentGamingHome"
    Write-Host 'Select ORBIT under Settings > Gaming > Xbox mode > Choose home app.'
  }
  Write-Host 'Windows controls Xbox Mode availability by OS version, market, device policy, and phased feature rollout; no Xbox app version is hard-coded by ORBIT.'
  Write-Host "Diagnostics: $diagnosticPath"

  if ($Launch) {
    try { Start-Process explorer.exe "shell:AppsFolder\$orbitAumid" } catch { Write-Warning "ORBIT was installed, but automatic launch failed: $($_.Exception.Message)" }
  }
  if ($OpenSettings) {
    try { Start-Process explorer.exe 'ms-settings:gaming-fullscreen' } catch { Write-Warning "ORBIT was installed, but Xbox Mode settings could not be opened automatically: $($_.Exception.Message)" }
  }
} catch {
  $originalError = $_
  $diagnostics.result = 'failed'
  $diagnostics.failedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  $diagnostics.error = [ordered]@{
    message = $originalError.Exception.Message
    hresult = $originalError.Exception.HResult
    fullyQualifiedErrorId = $originalError.FullyQualifiedErrorId
  }

  if (!$ValidateOnly) {
    $diagnostics.phase = 'rollback'
    $canRestoreMachinePreparation = !$packageDeploymentCompleted
    if ($packageDeploymentCompleted -and !$existingPackage) {
      try {
        $newPackage = Get-InstalledOrbitPackage
        if ($newPackage) { Remove-AppxPackage -Package $newPackage.PackageFullName -Confirm:$false }
        if (Get-InstalledOrbitPackage) { throw 'The failed first installation is still registered after rollback.' }
        $packageRollbackCompleted = $true
        $canRestoreMachinePreparation = $true
      } catch {
        $diagnostics.rollbackPackageError = $_.Exception.Message
      }
    }

    if ($canRestoreMachinePreparation -and $developerModeChanged) {
      try {
        $developerModeKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
        if ($developerModePropertyExisted) {
          New-ItemProperty -Path $developerModeKey -Name AllowDevelopmentWithoutDevLicense -PropertyType DWord -Value $developerModeOriginalValue -Force | Out-Null
        } else {
          Remove-ItemProperty -LiteralPath $developerModeKey -Name AllowDevelopmentWithoutDevLicense -ErrorAction SilentlyContinue
        }
        $developerModeRollbackCompleted = $true
      } catch {
        $diagnostics.rollbackDeveloperModeError = $_.Exception.Message
      }
    }

    $legacyPackageStillRegistered = $false
    if ($legacyPackage) {
      try { $legacyPackageStillRegistered = $null -ne (Get-LegacyOrbitPackage) } catch {}
    }
    $diagnostics.rollback = [ordered]@{
      packageRemovedAfterFailedFirstInstall = $packageRollbackCompleted
      developerModeRestored = $developerModeRollbackCompleted
      legacyPackagePreserved = $legacyPackageStillRegistered
    }
    $diagnostics.phase = 'failed'
    try { Write-InstallDiagnostics $diagnostics } catch { Write-Warning "Installation diagnostics could not be written: $($_.Exception.Message)" }
  }
  if ($UpdateOnly -and $Launch) {
    try {
      $recoverPackage = Get-InstalledOrbitPackage
      if ($recoverPackage) {
        $recoverAumid = "$($recoverPackage.PackageFamilyName)!$expectedApplicationId"
        Start-Process explorer.exe "shell:AppsFolder\$recoverAumid"
      }
    } catch {
      Write-Warning "The previous ORBIT installation could not be restarted automatically: $($_.Exception.Message)"
    }
  }
  throw $originalError
} finally {
  if ($certificate) { $certificate.Dispose() }
}
