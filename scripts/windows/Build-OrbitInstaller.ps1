[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$certificateDir = Join-Path $repoRoot '.certificates'
$pfxPath = Join-Path $certificateDir 'orbit-development.pfx'
$cerPath = Join-Path $certificateDir 'orbit-development.cer'
$passwordPath = Join-Path $certificateDir 'orbit-development-password.xml'
$releaseDir = Join-Path $repoRoot 'release'
$securePassword = $null
$passwordPointer = [IntPtr]::Zero
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (!$node) { throw 'node.exe is required to build the ORBIT Windows installer.' }

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
  & (Join-Path $PSScriptRoot 'New-OrbitDevCertificate.ps1')

  $securePassword = Import-Clixml -LiteralPath $passwordPath
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $env:WIN_CSC_LINK = $pfxPath
  $env:WIN_CSC_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)

  Invoke-LocalNodeTool 'node_modules\typescript\bin\tsc' @('--noEmit', '-p', 'tsconfig.node.json')
  Invoke-LocalNodeTool 'node_modules\typescript\bin\tsc' @('--noEmit', '-p', 'tsconfig.web.json')
  Invoke-LocalNodeTool 'node_modules\electron-vite\bin\electron-vite.js' @('build')
  Invoke-LocalNodeTool 'node_modules\electron-builder\out\cli\cli.js' @('--win', 'nsis', '--x64', '--publish', 'never')

  Copy-Item -LiteralPath $cerPath -Destination (Join-Path $releaseDir 'ORBIT-Development.cer') -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install-OrbitDevelopmentCertificate.ps1') -Destination (Join-Path $releaseDir 'Install-OrbitDevelopmentCertificate.ps1') -Force
  Copy-Item -LiteralPath (Join-Path $repoRoot 'resources\release-manifest.json') -Destination (Join-Path $releaseDir 'release-manifest.json') -Force

  & (Join-Path $PSScriptRoot 'Verify-OrbitRelease.ps1')
} finally {
  Remove-Item Env:WIN_CSC_LINK -ErrorAction SilentlyContinue
  Remove-Item Env:WIN_CSC_KEY_PASSWORD -ErrorAction SilentlyContinue
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  Pop-Location
}
