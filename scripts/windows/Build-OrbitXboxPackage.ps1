[CmdletBinding()]
param(
  [switch]$SkipCompile
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$releaseDir = Join-Path $repoRoot 'release'
$releaseMetadataPath = Join-Path $repoRoot 'resources\release-manifest.json'
$releaseMetadata = Get-Content -LiteralPath $releaseMetadataPath -Raw | ConvertFrom-Json
$displayVersion = [string]$releaseMetadata.displayVersion
$windowsFileVersion = [string]$releaseMetadata.windowsFileVersion
$appOutDir = Join-Path $releaseDir 'win-unpacked'
$stageDir = Join-Path $releaseDir '_orbit-xbox-stage'
$bundleDir = Join-Path $releaseDir '_orbit-xbox-bundle'
$appxFileName = "ORBIT-Beta-XboxMode-$displayVersion-x64.appx"
$bundleFileName = "ORBIT-Beta-XboxMode-$displayVersion-x64.zip"
$oneClickInstallerFileName = "ORBIT-Beta-XboxMode-Setup-$displayVersion-x64.exe"
$appxPath = Join-Path $releaseDir $appxFileName
$bundlePath = Join-Path $releaseDir $bundleFileName
$oneClickInstallerPath = Join-Path $releaseDir $oneClickInstallerFileName
$certificateDir = Join-Path $repoRoot '.certificates'
$pfxPath = Join-Path $certificateDir 'orbit-development.pfx'
$cerPath = Join-Path $certificateDir 'orbit-development.cer'
$passwordPath = Join-Path $certificateDir 'orbit-development-password.xml'
$securePassword = $null
$passwordPointer = [IntPtr]::Zero
$plainPassword = $null

function Assert-ReleaseChildPath {
  param([string]$Path)
  $resolvedRelease = [System.IO.Path]::GetFullPath($releaseDir).TrimEnd('\') + '\'
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  if (!$resolvedPath.StartsWith($resolvedRelease, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the release directory: $resolvedPath"
  }
}

function Get-WindowsSdkTool {
  param([string]$Name)
  $sdkBuildToolsVersion = '10.0.26100.8249'
  $sdkToolVersion = '10.0.26100.0'
  $toolRoot = Join-Path $repoRoot ".tools\windows-sdk-buildtools\$sdkBuildToolsVersion"
  $packagePath = Join-Path $toolRoot 'sdk.nupkg'
  $extractPath = Join-Path $toolRoot 'package'
  $toolPath = Join-Path $extractPath "bin\$sdkToolVersion\x64\$Name"

  if (!(Test-Path -LiteralPath $toolPath)) {
    New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
    if (!(Test-Path -LiteralPath $packagePath)) {
      $packageUrl = "https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.buildtools/$sdkBuildToolsVersion/microsoft.windows.sdk.buildtools.$sdkBuildToolsVersion.nupkg"
      Write-Host "Downloading Microsoft Windows SDK BuildTools $sdkBuildToolsVersion..."
      Invoke-WebRequest -Uri $packageUrl -OutFile $packagePath
    }
    if (!(Test-Path -LiteralPath $extractPath)) {
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      [System.IO.Compression.ZipFile]::ExtractToDirectory($packagePath, $extractPath)
    }
  }
  if (!(Test-Path -LiteralPath $toolPath)) { throw "Windows SDK tool is missing after extraction: $toolPath" }
  return $toolPath
}

foreach ($temporaryPath in @($stageDir, $bundleDir)) {
  Assert-ReleaseChildPath $temporaryPath
}

Push-Location $repoRoot
try {
  New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
  & (Join-Path $PSScriptRoot 'Generate-OrbitBranding.ps1')
  & (Join-Path $PSScriptRoot 'New-OrbitDevCertificate.ps1')

  $securePassword = Import-Clixml -LiteralPath $passwordPath
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $env:WIN_CSC_LINK = $pfxPath
  $env:WIN_CSC_KEY_PASSWORD = $plainPassword

  if (!$SkipCompile) {
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript validation failed.' }

    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Renderer/main build failed.' }

    & npx.cmd electron-builder --win dir --x64 --publish never
    if ($LASTEXITCODE -ne 0) { throw 'Windows application build failed.' }
  }

  if (!(Test-Path -LiteralPath (Join-Path $appOutDir 'ORBIT.exe'))) {
    throw "Missing packaged application: $appOutDir"
  }

  foreach ($temporaryPath in @($stageDir, $bundleDir)) {
    if (Test-Path -LiteralPath $temporaryPath) {
      Remove-Item -LiteralPath $temporaryPath -Recurse -Force
    }
  }
  Remove-Item -LiteralPath $appxPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $bundlePath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $oneClickInstallerPath -Force -ErrorAction SilentlyContinue

  New-Item -ItemType Directory -Force -Path (Join-Path $stageDir 'app') | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $stageDir 'assets') | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $stageDir 'Public') | Out-Null
  Copy-Item -Path (Join-Path $appOutDir '*') -Destination (Join-Path $stageDir 'app') -Recurse -Force
  Copy-Item -Path (Join-Path $repoRoot 'build\appx\*') -Destination (Join-Path $stageDir 'assets') -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $repoRoot 'build\xbox\AppxManifest.xml') -Destination (Join-Path $stageDir 'AppxManifest.xml') -Force
  Copy-Item -LiteralPath (Join-Path $repoRoot 'build\xbox\CustomCapability.SCCD') -Destination (Join-Path $stageDir 'CustomCapability.SCCD') -Force
  Copy-Item -Path (Join-Path $repoRoot 'build\xbox\Public\*') -Destination (Join-Path $stageDir 'Public') -Recurse -Force

  $makeAppx = Get-WindowsSdkTool 'makeappx.exe'
  $signTool = Get-WindowsSdkTool 'signtool.exe'

  & $makeAppx pack /o /d $stageDir /p $appxPath
  if ($LASTEXITCODE -ne 0) { throw 'MakeAppx failed to create the Xbox Mode package.' }

  & $signTool sign /fd SHA256 /a /f $pfxPath /p $plainPassword /d ORBIT $appxPath
  if ($LASTEXITCODE -ne 0) { throw 'SignTool failed to sign the Xbox Mode package.' }

  Copy-Item -LiteralPath $cerPath -Destination (Join-Path $releaseDir 'ORBIT-Development.cer') -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install-OrbitXboxMode.ps1') -Destination (Join-Path $releaseDir 'Install-OrbitXboxMode.ps1') -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install-OrbitXboxMode.bat') -Destination (Join-Path $releaseDir 'Install-OrbitXboxMode.bat') -Force
  Copy-Item -LiteralPath (Join-Path $repoRoot 'resources\release-manifest.json') -Destination (Join-Path $releaseDir 'release-manifest.json') -Force

  $makeNsis = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis') -Recurse -Filter makensis.exe -ErrorAction Stop |
    Where-Object { $_.FullName -match '\\Bin\\makensis\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if (!$makeNsis) { throw 'The NSIS compiler was not found in the electron-builder cache.' }

  & $makeNsis.FullName `
    "/DORBIT_ROOT=$repoRoot" `
    "/DAPPX_PATH=$appxPath" `
    "/DCERT_PATH=$cerPath" `
    "/DINSTALL_SCRIPT_PATH=$(Join-Path $PSScriptRoot 'Install-OrbitXboxMode.ps1')" `
    "/DDISPLAY_VERSION=$displayVersion" `
    "/DFILE_VERSION=$windowsFileVersion" `
    "/DOUTPUT_PATH=$oneClickInstallerPath" `
    (Join-Path $repoRoot 'build\xbox\OrbitXboxInstaller.nsi')
  if ($LASTEXITCODE -ne 0) { throw 'NSIS failed to create the one-click Xbox Mode setup.' }

  & $signTool sign /fd SHA256 /a /f $pfxPath /p $plainPassword /d 'ORBIT Xbox Mode Setup' $oneClickInstallerPath
  if ($LASTEXITCODE -ne 0) { throw 'SignTool failed to sign the one-click Xbox Mode setup.' }

  & (Join-Path $PSScriptRoot 'Verify-OrbitXboxPackage.ps1')

  New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null
  foreach ($fileName in @(
    $appxFileName,
    'ORBIT-Development.cer',
    'Install-OrbitXboxMode.bat',
    'Install-OrbitXboxMode.ps1',
    'XBOX-MODE-README.txt',
    'xbox-distribution-manifest.json',
    'XBOX-SHA256SUMS.txt'
  )) {
    Copy-Item -LiteralPath (Join-Path $releaseDir $fileName) -Destination $bundleDir -Force
  }
  Compress-Archive -Path (Join-Path $bundleDir '*') -DestinationPath $bundlePath -CompressionLevel Optimal -Force

  Write-Host "ORBIT Xbox Mode package ready: $appxPath"
  Write-Host "One-click Xbox Mode setup ready: $oneClickInstallerPath"
  Write-Host "Portable test bundle ready: $bundlePath"
} finally {
  Remove-Item Env:WIN_CSC_LINK -ErrorAction SilentlyContinue
  Remove-Item Env:WIN_CSC_KEY_PASSWORD -ErrorAction SilentlyContinue
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  $plainPassword = $null
  if (Test-Path -LiteralPath $stageDir) { Remove-Item -LiteralPath $stageDir -Recurse -Force }
  if (Test-Path -LiteralPath $bundleDir) { Remove-Item -LiteralPath $bundleDir -Recurse -Force }
  Pop-Location
}
