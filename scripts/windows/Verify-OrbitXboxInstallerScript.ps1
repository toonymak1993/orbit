[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$installerScriptPath = Join-Path $PSScriptRoot 'Install-OrbitXboxMode.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $installerScriptPath,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) {
  throw "The Xbox Mode installer has PowerShell parse errors: $($parseErrors[0].Message)"
}

$forbiddenValueReads = @($ast.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.CommandAst] -and
    $node.GetCommandName() -eq 'Get-ItemPropertyValue'
}, $true))
if ($forbiddenValueReads.Count -gt 0) {
  throw 'The Xbox Mode installer must not use Get-ItemPropertyValue for optional Windows registry values.'
}

$helperAst = $ast.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Get-OptionalRegistryProperty'
}, $true)
if (!$helperAst) { throw 'Get-OptionalRegistryProperty is missing from the Xbox Mode installer.' }

$installerText = Get-Content -LiteralPath $installerScriptPath -Raw
if ($installerText -match 'function\s+Add-ValidatedCertificateTrust|Import-Certificate') {
  throw 'The public Certum installer must not add certificates to a Windows trust store.'
}
if ($installerText -match 'Remove-AppxPackage\s+-Package\s+\$legacyPackage\.PackageFullName') {
  throw 'The installer must retain the packaged legacy AppX because PreserveApplicationData is unsupported for this migration.'
}
$newPackageValidation = $installerText.IndexOf('$null = Assert-InstalledOrbitPackage $installedPackage', [System.StringComparison]::Ordinal)
$legacyRetention = $installerText.IndexOf('legacyPackageRetained = $true', [System.StringComparison]::Ordinal)
if ($newPackageValidation -lt 0 -or $legacyRetention -lt 0 -or $legacyRetention -le $newPackageValidation) {
  throw 'The legacy package retention contract may only be recorded after the new Certum package passes post-install validation.'
}
if ($installerText -notmatch [regex]::Escape('61E90C0AACBF2F407A575903FCC197F45B61706D')) {
  throw 'The Xbox Mode installer does not pin the official Certum signer.'
}

. ([scriptblock]::Create($helperAst.Extent.Text))

$missingKey = "HKCU:\Software\ORBIT-Installer-ReadOnly-Check-$([guid]::NewGuid().ToString('N'))"
if (Test-Path -LiteralPath $missingKey) { throw 'The generated missing-key check unexpectedly exists.' }
if ($null -ne (Get-OptionalRegistryProperty -Path $missingKey -Name 'GamingHomeApp')) {
  throw 'Optional registry lookup did not return null for a missing key.'
}

$existingKey = 'HKCU:\Environment'
if (!(Test-Path -LiteralPath $existingKey)) {
  throw 'The current Windows account has no HKCU Environment registry key for the read-only regression check.'
}
$missingName = "ORBIT_Installer_ReadOnly_Check_$([guid]::NewGuid().ToString('N'))"
if ($null -ne (Get-OptionalRegistryProperty -Path $existingKey -Name $missingName)) {
  throw 'Optional registry lookup did not return null for a missing value on an existing key.'
}

$environmentState = Get-ItemProperty -LiteralPath $existingKey
$existingProperty = $environmentState.PSObject.Properties |
  Where-Object { $_.Name -notlike 'PS*' } |
  Select-Object -First 1
if (!$existingProperty) { throw 'The HKCU Environment key has no value for the read-only regression check.' }
$resolvedProperty = Get-OptionalRegistryProperty -Path $existingKey -Name $existingProperty.Name
if ($null -eq $resolvedProperty -or $resolvedProperty.Value -ne $existingProperty.Value) {
  throw 'Optional registry lookup did not preserve an existing value.'
}

Write-Host 'Xbox Mode installer script verified: syntax and optional registry reads passed.'
