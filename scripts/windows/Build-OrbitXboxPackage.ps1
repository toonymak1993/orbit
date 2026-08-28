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
$releaseChannel = ([string]$releaseMetadata.channel).Trim().ToLowerInvariant()
if ($releaseChannel -notin @('beta', 'stable')) {
  throw "Unsupported ORBIT release channel: $releaseChannel"
}
$isBeta = $releaseChannel -eq 'beta'
$artifactPrefix = if ($isBeta) { 'ORBIT-Beta' } else { 'ORBIT' }
$windowsFileVersion = [string]$releaseMetadata.windowsFileVersion
$xboxPackageVersion = [version][string]$releaseMetadata.xboxPackageVersion
$xboxMinimumWindowsVersion = [version][string]$releaseMetadata.xboxMode.minimumWindowsVersion
$appOutDir = Join-Path $releaseDir 'win-unpacked'
$stageDir = Join-Path $releaseDir '_orbit-xbox-stage'
$bundleDir = Join-Path $releaseDir '_orbit-xbox-bundle'
$appxFileName = "$artifactPrefix-XboxMode-$displayVersion-x64.appx"
$bundleFileName = "$artifactPrefix-XboxMode-$displayVersion-x64.zip"
$oneClickInstallerFileName = "$artifactPrefix-XboxMode-Setup-$displayVersion-x64.exe"
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
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (!$node) { throw 'node.exe is required to build the ORBIT Xbox Mode package.' }

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
  $packageHashPath = Join-Path $toolRoot 'sdk.nupkg.sha512'
  $extractPath = Join-Path $toolRoot 'package'
  $toolPath = Join-Path $extractPath "bin\$sdkToolVersion\x64\$Name"

  New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
  $packageUrl = "https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.buildtools/$sdkBuildToolsVersion/microsoft.windows.sdk.buildtools.$sdkBuildToolsVersion.nupkg"
  if (!(Test-Path -LiteralPath $packagePath)) {
    Write-Host "Downloading Microsoft Windows SDK BuildTools $sdkBuildToolsVersion..."
    Invoke-WebRequest -Uri $packageUrl -OutFile $packagePath
  }
  if (!(Test-Path -LiteralPath $packageHashPath)) {
    $registrationUrl = "https://api.nuget.org/v3/registration5-semver1/microsoft.windows.sdk.buildtools/$sdkBuildToolsVersion.json"
    $registration = Invoke-RestMethod -Uri $registrationUrl
    if ([string]$registration.packageContent -ne $packageUrl -or [string]::IsNullOrWhiteSpace([string]$registration.catalogEntry)) {
      throw 'NuGet registration metadata does not match the requested Windows SDK BuildTools package.'
    }
    $catalogEntry = Invoke-RestMethod -Uri ([string]$registration.catalogEntry)
    if (
      [string]$catalogEntry.id -ne 'Microsoft.Windows.SDK.BuildTools' -or
      [string]$catalogEntry.version -ne $sdkBuildToolsVersion -or
      [string]$catalogEntry.packageHashAlgorithm -ne 'SHA512' -or
      [string]::IsNullOrWhiteSpace([string]$catalogEntry.packageHash)
    ) {
      throw 'NuGet catalog metadata does not contain the expected Windows SDK SHA-512 contract.'
    }
    [string]$catalogEntry.packageHash | Set-Content -LiteralPath $packageHashPath -Encoding ASCII
  }

  $expectedPackageHash = (Get-Content -LiteralPath $packageHashPath -Raw).Trim()
  $sha512 = [System.Security.Cryptography.SHA512]::Create()
  $packageStream = [System.IO.File]::OpenRead($packagePath)
  try {
    $actualPackageHash = [Convert]::ToBase64String($sha512.ComputeHash($packageStream))
  } finally {
    $packageStream.Dispose()
    $sha512.Dispose()
  }
  if ($actualPackageHash -cne $expectedPackageHash) {
    throw 'The cached Windows SDK BuildTools package failed its NuGet SHA-512 integrity check.'
  }
  if (!(Test-Path -LiteralPath $extractPath)) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($packagePath, $extractPath)
  }
  if (!(Test-Path -LiteralPath $toolPath)) { throw "Windows SDK tool is missing after extraction: $toolPath" }
  return $toolPath
}

foreach ($temporaryPath in @($stageDir, $bundleDir)) {
  Assert-ReleaseChildPath $temporaryPath
}

Push-Location $repoRoot
try {
  & (Join-Path $PSScriptRoot 'Verify-OrbitXboxInstallerScript.ps1')
  New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
  & (Join-Path $PSScriptRoot 'Generate-OrbitBranding.ps1')
  & (Join-Path $PSScriptRoot 'New-OrbitDevCertificate.ps1')

  $securePassword = Import-Clixml -LiteralPath $passwordPath
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $env:WIN_CSC_LINK = $pfxPath
  $env:WIN_CSC_KEY_PASSWORD = $plainPassword

  if (!$SkipCompile) {
    Invoke-LocalNodeTool 'node_modules\typescript\bin\tsc' @('--noEmit', '-p', 'tsconfig.node.json')
    Invoke-LocalNodeTool 'node_modules\typescript\bin\tsc' @('--noEmit', '-p', 'tsconfig.web.json')
    Invoke-LocalNodeTool 'node_modules\electron-vite\bin\electron-vite.js' @('build')
    Invoke-LocalNodeTool 'node_modules\electron-builder\out\cli\cli.js' @('--win', 'dir', '--x64', '--publish', 'never')
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

  # Release metadata is the single version source. Stamp only the disposable
  # staging copy so a package cannot accidentally ship stale identity,
  # channel, or Gaming Home registration data after the next release bump.
  $stagedManifestPath = Join-Path $stageDir 'AppxManifest.xml'
  [xml]$stagedManifest = Get-Content -LiteralPath $stagedManifestPath -Raw
  $manifestNamespace = [System.Xml.XmlNamespaceManager]::new($stagedManifest.NameTable)
  $manifestNamespace.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
  $stagedIdentity = $stagedManifest.SelectSingleNode('/f:Package/f:Identity', $manifestNamespace)
  if (!$stagedIdentity) { throw 'The staged Xbox manifest has no package identity.' }
  $stagedIdentity.SetAttribute('Version', $xboxPackageVersion.ToString())
  foreach ($targetFamily in $stagedManifest.SelectNodes('/f:Package/f:Dependencies/f:TargetDeviceFamily', $manifestNamespace)) {
    $targetFamily.SetAttribute('MinVersion', $xboxMinimumWindowsVersion.ToString())
  }
  $stagedManifest.Save($stagedManifestPath)

  $registrationPath = Join-Path $stageDir 'Public\registration.json'
  $registration = Get-Content -LiteralPath $registrationPath -Raw | ConvertFrom-Json
  $registration.version = $xboxPackageVersion.ToString()
  $registration.channel = $releaseChannel
  $registration | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $registrationPath -Encoding UTF8

  $makeAppx = Get-WindowsSdkTool 'makeappx.exe'
  $signTool = Get-WindowsSdkTool 'signtool.exe'

  & $makeAppx pack /o /d $stageDir /p $appxPath
  if ($LASTEXITCODE -ne 0) { throw 'MakeAppx failed to create the Xbox Mode package.' }

  & $signTool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a /f $pfxPath /p $plainPassword /d ORBIT $appxPath
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
    "/DIS_BETA=$([int]$isBeta)" `
    "/DOUTPUT_PATH=$oneClickInstallerPath" `
    (Join-Path $repoRoot 'build\xbox\OrbitXboxInstaller.nsi')
  if ($LASTEXITCODE -ne 0) { throw 'NSIS failed to create the one-click Xbox Mode setup.' }

  & $signTool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a /f $pfxPath /p $plainPassword /d 'ORBIT Xbox Mode Setup' $oneClickInstallerPath
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
