function Get-OrbitSigningProfile {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)

  $resolvedRepo = [System.IO.Path]::GetFullPath($RepoRoot)
  $metadataPath = Join-Path $resolvedRepo 'resources\code-signing.json'
  if (!(Test-Path -LiteralPath $metadataPath)) {
    throw "Missing ORBIT code-signing metadata: $metadataPath"
  }

  $metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([int]$metadata.schemaVersion -ne 1) { throw 'Unsupported ORBIT code-signing metadata schema.' }
  if ([string]$metadata.provider -ne 'Certum SimplySign') { throw 'Unexpected ORBIT signing provider.' }
  if ([string]$metadata.storeLocation -ne 'CurrentUser' -or [string]$metadata.storeName -ne 'My') {
    throw 'ORBIT releases must use the CurrentUser\\My certificate store.'
  }

  $thumbprint = ([string]$metadata.thumbprint).Replace(' ', '').ToUpperInvariant()
  if ($thumbprint -notmatch '^[A-F0-9]{40}$') { throw 'Invalid ORBIT signer thumbprint.' }
  $certificateSha256 = ([string]$metadata.certificateSha256).Trim().ToLowerInvariant()
  if ($certificateSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid ORBIT public-certificate SHA-256.' }
  $timestampServer = [string]$metadata.timestampServer
  if ($timestampServer -ne 'http://time.certum.pl') { throw 'Unexpected ORBIT timestamp server.' }

  $relativeCertificatePath = ([string]$metadata.certificateFile).Replace('/', '\')
  $certificatePath = [System.IO.Path]::GetFullPath((Join-Path $resolvedRepo $relativeCertificatePath))
  $repoPrefix = $resolvedRepo.TrimEnd('\') + '\'
  if (!$certificatePath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The ORBIT public certificate must remain inside the repository.'
  }
  if (!(Test-Path -LiteralPath $certificatePath)) {
    throw "Missing ORBIT public code-signing certificate: $certificatePath"
  }
  if ((Get-FileHash -LiteralPath $certificatePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $certificateSha256) {
    throw 'The ORBIT public code-signing certificate failed its SHA-256 pin.'
  }

  $publicCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath)
  try {
    if ($publicCertificate.HasPrivateKey) { throw 'The repository certificate must never contain a private key.' }
    if ($publicCertificate.Thumbprint -ne $thumbprint) { throw 'The public certificate thumbprint does not match its metadata.' }
    if ($publicCertificate.Subject -ne [string]$metadata.subject) { throw 'The public certificate subject does not match its metadata.' }
    if ($publicCertificate.Issuer -ne [string]$metadata.issuer) { throw 'The public certificate issuer does not match its metadata.' }

    $codeSigningUsage = $false
    $digitalSignatureUsage = $false
    foreach ($extension in $publicCertificate.Extensions) {
      if ($extension -is [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]) {
        foreach ($usage in $extension.EnhancedKeyUsages) {
          if ($usage.Value -eq '1.3.6.1.5.5.7.3.3') { $codeSigningUsage = $true }
        }
      }
      if ($extension -is [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]) {
        $digitalSignatureUsage =
          ($extension.KeyUsages -band [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature) -ne 0
      }
    }
    if (!$codeSigningUsage -or !$digitalSignatureUsage) {
      throw 'The ORBIT public certificate is not valid for code signing.'
    }
  } finally {
    $publicCertificate.Dispose()
  }

  return [pscustomobject]@{
    MetadataPath = $metadataPath
    CertificatePath = $certificatePath
    CertificateSha256 = $certificateSha256
    Thumbprint = $thumbprint
    Subject = [string]$metadata.subject
    CommonName = [string]$metadata.commonName
    Issuer = [string]$metadata.issuer
    TimestampServer = $timestampServer
    StoreName = [string]$metadata.storeName
    LegacyPublisher = [string]$metadata.legacy.publisher
    LegacyThumbprint = ([string]$metadata.legacy.thumbprint).Replace(' ', '').ToUpperInvariant()
  }
}

function Assert-OrbitSigningCertificateAvailable {
  param([Parameter(Mandatory = $true)]$Profile)

  $matches = @(
    Get-ChildItem -LiteralPath 'Cert:\CurrentUser\My' -CodeSigningCert -ErrorAction Stop |
      Where-Object { $_.Thumbprint -eq $Profile.Thumbprint }
  )
  if ($matches.Count -ne 1) {
    throw "The Certum SimplySign certificate $($Profile.Thumbprint) is not available in CurrentUser\\My. Connect SimplySign Desktop in this Windows session first."
  }
  $certificate = $matches[0]
  if (!$certificate.HasPrivateKey) { throw 'The SimplySign certificate is visible, but its cloud private key is unavailable.' }
  if ($certificate.Subject -ne $Profile.Subject -or $certificate.Issuer -ne $Profile.Issuer) {
    throw 'The available SimplySign certificate does not match the pinned ORBIT identity.'
  }
  if ($certificate.NotBefore -gt (Get-Date).AddMinutes(5) -or $certificate.NotAfter -le (Get-Date).AddDays(30)) {
    throw 'The SimplySign certificate is outside the safe ORBIT release window.'
  }
  return $certificate
}

function Assert-OrbitSignedFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Profile
  )

  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne 'Valid') {
    throw "Invalid public Authenticode signature for $Path ($($signature.Status): $($signature.StatusMessage))"
  }
  if (!$signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $Profile.Thumbprint) {
    throw "Unexpected public signer for $Path"
  }
  if (!$signature.TimeStamperCertificate) { throw "Missing RFC3161 timestamp for $Path" }
  return $signature
}

function Invoke-OrbitSignFile {
  param(
    [Parameter(Mandatory = $true)][string]$SignTool,
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)]$Profile
  )

  if (!(Test-Path -LiteralPath $SignTool)) { throw "SignTool is missing: $SignTool" }
  if (!(Test-Path -LiteralPath $Path)) { throw "Signing target is missing: $Path" }
  & $SignTool sign `
    /fd SHA256 `
    /tr $Profile.TimestampServer `
    /td SHA256 `
    /sha1 $Profile.Thumbprint `
    /s $Profile.StoreName `
    /d $Description `
    $Path
  if ($LASTEXITCODE -ne 0) { throw "SignTool failed for $Path" }
  return Assert-OrbitSignedFile -Path $Path -Profile $Profile
}
