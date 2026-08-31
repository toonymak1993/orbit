[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ImagePath,

  [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resultMarker = 'ORBIT_WALLPAPER_RESULT:'
$result = [ordered]@{
  desktop = 'failed'
  lockScreen = 'failed'
}

function Write-OrbitWallpaperResult {
  param([int]$ExitCode = 0)

  [Console]::Out.WriteLine(
    $resultMarker + ($result | ConvertTo-Json -Compress)
  )
  exit $ExitCode
}

function Wait-WindowsRuntimeOperation {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Operation,

    [Parameter(Mandatory = $true)]
    [Type]$ResultType
  )

  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethodDefinition -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } |
    Select-Object -First 1

  if ($null -eq $asTaskMethod) {
    throw 'Windows Runtime task bridge is unavailable.'
  }

  $task = $asTaskMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.GetAwaiter().GetResult()
}

function Wait-WindowsRuntimeAction {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Action
  )

  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      -not $_.IsGenericMethodDefinition -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
    } |
    Select-Object -First 1

  if ($null -eq $asTaskMethod) {
    throw 'Windows Runtime action bridge is unavailable.'
  }

  $task = $asTaskMethod.Invoke($null, @($Action))
  [void]$task.GetAwaiter().GetResult()
}

try {
  $resolvedImagePath = (Resolve-Path -LiteralPath $ImagePath -ErrorAction Stop).Path
  $imageFile = Get-Item -LiteralPath $resolvedImagePath -ErrorAction Stop
  if ($imageFile.PSIsContainer -or $imageFile.Length -le 0) {
    throw 'The ORBIT wallpaper asset is invalid.'
  }

  $null = Add-Type -AssemblyName System.Runtime.WindowsRuntime -PassThru
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.System.UserProfile.LockScreen, Windows.System.UserProfile, ContentType = WindowsRuntime]
  $null = [Windows.System.UserProfile.UserProfilePersonalizationSettings, Windows.System.UserProfile, ContentType = WindowsRuntime]
  $personalizationSupported = [Windows.System.UserProfile.UserProfilePersonalizationSettings]::IsSupported()

  $nativeType = Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Orbit.Windows {
  public static class WallpaperNative {
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SystemParametersInfo(
      uint action,
      uint parameter,
      string value,
      uint flags
    );
  }
}
'@ -PassThru

  if ($ValidateOnly) {
    $result.desktop = 'validated'
    $result.lockScreen = 'validated'
    Write-OrbitWallpaperResult
  }

  try {
    Set-ItemProperty -LiteralPath 'HKCU:\Control Panel\Desktop' -Name WallpaperStyle -Value '10'
    Set-ItemProperty -LiteralPath 'HKCU:\Control Panel\Desktop' -Name TileWallpaper -Value '0'

    $setDesktop = $nativeType::SystemParametersInfo(20, 0, $resolvedImagePath, 3)
    $result.desktop = if ($setDesktop) { 'applied' } else { 'failed' }
  } catch {
    $result.desktop = 'failed'
  }

  try {
    $storageOperation = [Windows.Storage.StorageFile]::GetFileFromPathAsync($resolvedImagePath)
    $storageFile = Wait-WindowsRuntimeOperation $storageOperation ([Windows.Storage.StorageFile])
    $lockScreenAction = [Windows.System.UserProfile.LockScreen]::SetImageFileAsync($storageFile)
    Wait-WindowsRuntimeAction $lockScreenAction
    $result.lockScreen = 'applied'
  } catch {
    if (-not $personalizationSupported) {
      $result.lockScreen = 'unsupported'
    } else {
      try {
        $personalization = [Windows.System.UserProfile.UserProfilePersonalizationSettings]::Current
        $lockScreenOperation = $personalization.TrySetLockScreenImageAsync($storageFile)
        $setLockScreen = Wait-WindowsRuntimeOperation $lockScreenOperation ([bool])
        $result.lockScreen = if ($setLockScreen) { 'applied' } else { 'failed' }
      } catch {
        $result.lockScreen = 'failed'
      }
    }
  }

  Write-OrbitWallpaperResult
} catch {
  Write-OrbitWallpaperResult 1
}
