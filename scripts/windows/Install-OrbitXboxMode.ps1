[CmdletBinding()]
param(
  [string]$PackagePath,
  [string]$CertificatePath,
  [switch]$Launch
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($PackagePath)) {
  $PackagePath = Join-Path $PSScriptRoot 'ORBIT-XboxMode-0.0.0.3-x64.appx'
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
  $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  exit $process.ExitCode
}

$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path
$resolvedCertificate = (Resolve-Path -LiteralPath $CertificatePath).Path
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($resolvedCertificate)
if ($certificate.Subject -ne 'CN=ORBIT Development') {
  throw "Unexpected certificate subject: $($certificate.Subject)"
}

$minimumVersion = [version]'10.0.26100.7019'
$windowsVersion = [Environment]::OSVersion.Version
if ($windowsVersion -lt $minimumVersion) {
  throw "Xbox Mode requires Windows $minimumVersion or newer. This PC reports $windowsVersion."
}

$signature = Get-AuthenticodeSignature -FilePath $resolvedPackage
if (!$signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint) {
  throw 'The AppX package is not signed by the supplied ORBIT certificate.'
}

Write-Host 'Installing the ORBIT development certificate into LocalMachine\TrustedPeople...'
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

Write-Host 'Installing the ORBIT Xbox Mode package...'
Add-AppxPackage -Path $resolvedPackage -ForceApplicationShutdown -ForceUpdateFromAnyVersion
$installedPackage = Get-AppxPackage -Name 'ORBIT.GamingHome' | Sort-Object Version -Descending | Select-Object -First 1
if (!$installedPackage) {
  throw 'ORBIT was installed, but its package identity could not be found.'
}

Write-Host "ORBIT Xbox Mode package installed: $($installedPackage.Version)"
Write-Host 'Next: Settings > Gaming > Xbox mode > Choose home app > ORBIT.'
Write-Host 'If Xbox mode is not visible, update Windows and enable full-screen experience support for this handheld.'

if ($Launch) {
  Start-Process explorer.exe "shell:AppsFolder\$($installedPackage.PackageFamilyName)!ORBIT"
}
