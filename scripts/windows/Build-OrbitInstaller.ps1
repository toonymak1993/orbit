[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$releaseDir = Join-Path $repoRoot 'release'
$signingCertificate = $null
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (!$node) { throw 'node.exe is required to build the ORBIT Windows installer.' }
. (Join-Path $PSScriptRoot 'OrbitSigning.ps1')
$signingProfile = Get-OrbitSigningProfile -RepoRoot $repoRoot

function Invoke-LocalNodeTool {
  param(
    [string]$RelativePath,
    [string[]]$Arguments
  )

  $toolPath = Join-Path $repoRoot $RelativePath
  if (!(Test-Path -LiteralPath $toolPath)) { throw "The local build tool is missing: $toolPath" }
  & $node.Source $toolPath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Local build tool failed: $RelativePath" }
}

Push-Location $repoRoot
try {
  & (Join-Path $PSScriptRoot 'Generate-OrbitBranding.ps1')
  $signingCertificate = Assert-OrbitSigningCertificateAvailable -Profile $signingProfile

  Invoke-LocalNodeTool 'node_modules\typescript\bin\tsc' @('--noEmit', '-p', 'tsconfig.node.json')
  Invoke-LocalNodeTool 'node_modules\typescript\bin\tsc' @('--noEmit', '-p', 'tsconfig.web.json')
  Invoke-LocalNodeTool 'node_modules\electron-vite\bin\electron-vite.js' @('build')
  Invoke-LocalNodeTool 'node_modules\electron-builder\out\cli\cli.js' @('--win', 'nsis', '--x64', '--publish', 'never')

  Copy-Item -LiteralPath $signingProfile.CertificatePath -Destination (Join-Path $releaseDir 'ORBIT-Code-Signing.cer') -Force
  Copy-Item -LiteralPath $signingProfile.MetadataPath -Destination (Join-Path $releaseDir 'code-signing.json') -Force
  Copy-Item -LiteralPath (Join-Path $repoRoot 'resources\release-manifest.json') -Destination (Join-Path $releaseDir 'release-manifest.json') -Force

  & (Join-Path $PSScriptRoot 'Verify-OrbitRelease.ps1')
} finally {
  if ($signingCertificate) { $signingCertificate.Dispose() }
  Pop-Location
}
