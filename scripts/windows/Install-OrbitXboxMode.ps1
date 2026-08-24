[CmdletBinding()]
param(
  [string]$PackagePath,
  [string]$CertificatePath,
  [switch]$Launch,
  [switch]$OpenSettings
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-DefaultXboxPackagePath {
  $candidates = @(
    Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'ORBIT-Beta-XboxMode-*-x64.appx' -File -ErrorAction SilentlyContinue
  )
  if ($candidates.Count -ne 1) {
    throw "Expected exactly one ORBIT Xbox Mode AppX next to this script, found $($candidates.Count)."
  }
  return $candidates[0].FullName
}

function Get-WindowsBuildInfo {
  $currentVersion = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  $build = [int]$currentVersion.CurrentBuild
  $ubr = [int]$currentVersion.UBR
  return [pscustomobject]@{
    Build = $build
    Ubr = $ubr
    Version = [version]"10.0.$build.$ubr"
    DisplayVersion = [string]$currentVersion.DisplayVersion
    Edition = [string]$currentVersion.EditionID
  }
}

function Test-NativeFseBuild {
  param([int]$Build, [int]$Ubr)

  switch ($Build) {
    26100 { return $Ubr -ge 8328 }
    26200 { return $Ubr -ge 8328 }
    26220 { return $Ubr -ge 7271 }
    26300 { return $Ubr -ge 7674 }
    28020 { return $Ubr -ge 1362 }
    default { return $Build -gt 28020 }
  }
}

if ([string]::IsNullOrWhiteSpace($PackagePath)) {
  $PackagePath = Get-DefaultXboxPackagePath
}
if ([string]::IsNullOrWhiteSpace($CertificatePath)) {
  $CertificatePath = Join-Path $PSScriptRoot 'ORBIT-Development.cer'
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$isAdministrator) {
  $arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"{0}"' -f $PSCommandPath),
    '-PackagePath', ('"{0}"' -f ([System.IO.Path]::GetFullPath($PackagePath))),
    '-CertificatePath', ('"{0}"' -f ([System.IO.Path]::GetFullPath($CertificatePath)))
  )
  if ($Launch) { $arguments += '-Launch' }
  if ($OpenSettings) { $arguments += '-OpenSettings' }
  $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  exit $process.ExitCode
}

$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path
$resolvedCertificate = (Resolve-Path -LiteralPath $CertificatePath).Path
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($resolvedCertificate)
if ($certificate.Subject -ne 'CN=ORBIT Development') {
  throw "Unexpected certificate subject: $($certificate.Subject)"
}

$windows = Get-WindowsBuildInfo
$minimumVersion = [version]'10.0.26100.7019'
if ($windows.Version -lt $minimumVersion) {
  throw "Xbox Mode requires Windows $minimumVersion or newer. This PC reports $($windows.Version)."
}
$nativeFse = Test-NativeFseBuild -Build $windows.Build -Ubr $windows.Ubr
Write-Host "Windows $($windows.DisplayVersion), build $($windows.Build).$($windows.Ubr) detected."
if ($nativeFse) {
  Write-Host 'Native Windows Full screen experience support detected; no display or device-form override is required.'
} else {
  Write-Warning 'This Windows build is in the legacy FSE range. The device may need Xbox Full Screen Experience Tool configuration before ORBIT can be selected as the home app.'
}

$gamingApp = Get-AppxPackage -Name 'Microsoft.GamingApp' | Sort-Object Version -Descending | Select-Object -First 1
$gameBar = Get-AppxPackage -Name 'Microsoft.XboxGamingOverlay' | Sort-Object Version -Descending | Select-Object -First 1
if (!$gamingApp) { Write-Warning 'Microsoft Xbox app is missing. Install or update it from Microsoft Store before entering Xbox Mode.' }
if (!$gameBar) { Write-Warning 'Xbox Game Bar is missing. Install or update it from Microsoft Store before entering Xbox Mode.' }

$signature = Get-AuthenticodeSignature -FilePath $resolvedPackage
if (!$signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint) {
  throw 'The AppX package is not signed by the supplied ORBIT certificate.'
}

Write-Host "Trusting the exact ORBIT beta certificate in LocalMachine\TrustedPeople: $($certificate.Thumbprint)"
Import-Certificate -FilePath $resolvedCertificate -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null

$developerModeKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
$developerMode = (Get-ItemProperty -Path $developerModeKey -Name AllowDevelopmentWithoutDevLicense -ErrorAction SilentlyContinue).AllowDevelopmentWithoutDevLicense
if ($developerMode -ne 1) {
  Write-Host 'Enabling Windows Developer Mode for the SCCD Gaming Home capability...'
  if (!(Test-Path -LiteralPath $developerModeKey)) {
    New-Item -Path $developerModeKey -Force | Out-Null
  }
  New-ItemProperty -Path $developerModeKey -Name AllowDevelopmentWithoutDevLicense -PropertyType DWord -Value 1 -Force | Out-Null
}

Write-Host 'Installing or updating the ORBIT Xbox Mode package...'
Add-AppxPackage -Path $resolvedPackage -ForceApplicationShutdown -ForceUpdateFromAnyVersion
$installedPackage = Get-AppxPackage -Name 'ORBIT.GamingHome' | Sort-Object Version -Descending | Select-Object -First 1
if (!$installedPackage) {
  throw 'ORBIT was installed, but its package identity could not be found.'
}

[xml]$installedManifest = Get-Content -LiteralPath (Join-Path $installedPackage.InstallLocation 'AppxManifest.xml') -Raw
$namespaceManager = [System.Xml.XmlNamespaceManager]::new($installedManifest.NameTable)
$namespaceManager.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
$namespaceManager.AddNamespace('uap3', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/3')
$namespaceManager.AddNamespace('uap4', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/4')
$gamingExtension = $installedManifest.SelectSingleNode("//uap3:AppExtension[@Name='windows.gamingApp']", $namespaceManager)
$gamingCapability = $installedManifest.SelectSingleNode("//uap4:CustomCapability[@Name='Microsoft.appCategory.gamingHome_8wekyb3d8bbwe']", $namespaceManager)
if (!$gamingExtension -or !$gamingCapability) {
  throw 'ORBIT installed, but Windows cannot see its Gaming Home extension or capability.'
}

$orbitAumid = "$($installedPackage.PackageFamilyName)!ORBIT"
$gamingConfigurationKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GamingConfiguration'
$currentGamingHome = [string](Get-ItemPropertyValue -LiteralPath $gamingConfigurationKey -Name GamingHomeApp -ErrorAction SilentlyContinue)

$device = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
$diagnosticDirectory = Join-Path $env:ProgramData 'ORBIT\Logs'
New-Item -ItemType Directory -Force -Path $diagnosticDirectory | Out-Null
[ordered]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  manufacturer = if ($device) { $device.Manufacturer } else { $null }
  model = if ($device) { $device.Model } else { $null }
  windowsDisplayVersion = $windows.DisplayVersion
  windowsBuild = "$($windows.Build).$($windows.Ubr)"
  nativeFseBuild = $nativeFse
  xboxAppVersion = if ($gamingApp) { $gamingApp.Version.ToString() } else { $null }
  gameBarVersion = if ($gameBar) { $gameBar.Version.ToString() } else { $null }
  orbitPackageVersion = $installedPackage.Version.ToString()
  orbitPackageFamilyName = $installedPackage.PackageFamilyName
  orbitAumid = $orbitAumid
  configuredGamingHome = $currentGamingHome
  orbitIsConfiguredGamingHome = $currentGamingHome -eq $orbitAumid
  certificateThumbprint = $certificate.Thumbprint
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $diagnosticDirectory 'xbox-mode-diagnostics.json') -Encoding UTF8

Write-Host "ORBIT Xbox Mode package installed: $($installedPackage.Version)"
Write-Host "ORBIT Gaming Home ID: $orbitAumid"
if ($currentGamingHome -eq $orbitAumid) {
  Write-Host 'ORBIT is already configured as the Windows Gaming Home app.'
} elseif ([string]::IsNullOrWhiteSpace($currentGamingHome)) {
  Write-Warning 'No Gaming Home app is selected yet. Select ORBIT in Windows Full screen experience settings.'
} else {
  Write-Warning "Another Gaming Home app is selected: $currentGamingHome"
  Write-Host 'Select ORBIT under Settings > Gaming > Full screen experience > Choose home app.'
}
Write-Host "Diagnostics: $diagnosticDirectory\xbox-mode-diagnostics.json"

if ($Launch) {
  Start-Process explorer.exe "shell:AppsFolder\$orbitAumid"
}
if ($OpenSettings) {
  Start-Process explorer.exe 'ms-settings:gaming-fullscreen'
}
