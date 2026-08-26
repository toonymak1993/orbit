[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$CertificatePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($CertificatePath)) {
  $releaseSibling = Join-Path $PSScriptRoot 'ORBIT-Development.cer'
  $CertificatePath = if (Test-Path -LiteralPath $releaseSibling) {
    $releaseSibling
  } else {
    Join-Path $PSScriptRoot '..\..\release\ORBIT-Development.cer'
  }
}

$resolvedCertificate = (Resolve-Path -LiteralPath $CertificatePath).Path
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($resolvedCertificate)

if ($certificate.Subject -ne 'CN=ORBIT Development') {
  throw "Unexpected certificate subject: $($certificate.Subject)"
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$isAdministrator) {
  $arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"{0}"' -f $PSCommandPath),
    '-CertificatePath', ('"{0}"' -f $resolvedCertificate)
  )
  $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  exit $process.ExitCode
}

Import-Certificate -FilePath $resolvedCertificate -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
Write-Host "Trusted ORBIT development publisher in LocalMachine\TrustedPeople: $($certificate.Thumbprint)"
Write-Host 'No certificate was added to a Root certificate store.'
Write-Warning 'This self-signed publisher is trusted only for ORBIT builds. Verify the thumbprint against the official ORBIT release before installing.'
