[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$SkipTrust
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$certificateDir = Join-Path $repoRoot '.certificates'
$pfxPath = Join-Path $certificateDir 'orbit-development.pfx'
$cerPath = Join-Path $certificateDir 'orbit-development.cer'
$passwordPath = Join-Path $certificateDir 'orbit-development-password.xml'
$metadataPath = Join-Path $certificateDir 'orbit-development.json'
$subject = 'CN=ORBIT Development'

New-Item -ItemType Directory -Force -Path $certificateDir | Out-Null

function Add-CertificateToCurrentUserStore {
  param(
    [string]$Path,
    [string]$StoreName
  )

  $publicCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($Path)
  $store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
    $StoreName,
    [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
  )
  try {
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $store.Add($publicCertificate)
  } finally {
    $store.Close()
    $publicCertificate.Dispose()
  }
}

$hasReusableCertificate =
  !$Force -and
  (Test-Path -LiteralPath $pfxPath) -and
  (Test-Path -LiteralPath $cerPath) -and
  (Test-Path -LiteralPath $passwordPath) -and
  (Test-Path -LiteralPath $metadataPath)

if (!$hasReusableCertificate) {
  $certificate = if (!$Force) {
    Get-ChildItem 'Cert:\CurrentUser\My' |
      Where-Object {
        $_.Subject -eq $subject -and
        $_.HasPrivateKey -and
        $_.NotAfter -gt (Get-Date).AddMonths(6)
      } |
      Sort-Object NotAfter -Descending |
      Select-Object -First 1
  }

  if (!$certificate) {
    $certificate = New-SelfSignedCertificate `
      -Type CodeSigningCert `
      -Subject $subject `
      -FriendlyName 'ORBIT Development Code Signing' `
      -CertStoreLocation 'Cert:\CurrentUser\My' `
      -KeyAlgorithm RSA `
      -KeyLength 3072 `
      -HashAlgorithm SHA256 `
      -KeyExportPolicy Exportable `
      -KeyUsage DigitalSignature `
      -NotAfter (Get-Date).AddYears(5)
  }

  $randomBytes = [byte[]]::new(48)
  $randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $randomGenerator.GetBytes($randomBytes)
  } finally {
    $randomGenerator.Dispose()
  }
  $plainPassword = [Convert]::ToBase64String($randomBytes)
  [Array]::Clear($randomBytes, 0, $randomBytes.Length)
  $securePassword = ConvertTo-SecureString $plainPassword -AsPlainText -Force
  $plainPassword = $null

  Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $securePassword -ChainOption EndEntityCertOnly | Out-Null
  Export-Certificate -Cert $certificate -FilePath $cerPath -Type CERT | Out-Null
  $securePassword | Export-Clixml -LiteralPath $passwordPath

  [ordered]@{
    schemaVersion = 1
    subject = $certificate.Subject
    thumbprint = $certificate.Thumbprint
    notBefore = $certificate.NotBefore.ToUniversalTime().ToString('o')
    notAfter = $certificate.NotAfter.ToUniversalTime().ToString('o')
    usage = 'orbit-community-beta-code-signing'
    privateKeyFile = '.certificates/orbit-development.pfx'
    publicCertificateFile = '.certificates/orbit-development.cer'
  } | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding UTF8
}

if (!$SkipTrust) {
  Add-CertificateToCurrentUserStore $cerPath 'TrustedPeople'
  Add-CertificateToCurrentUserStore $cerPath 'TrustedPublisher'
}

$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
Write-Host "ORBIT development certificate ready: $($metadata.thumbprint)"
Write-Host 'The private key stays encrypted in the ignored .certificates directory.'
