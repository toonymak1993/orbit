Unicode true
; The bootstrapper stays in the interactive user's context. The PowerShell
; installer elevates only the machine-wide preparation and verifies that UAC
; did not switch to a different account before doing the per-user AppX install.
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32

!ifndef DISPLAY_VERSION
  !error "DISPLAY_VERSION is required"
!endif
!ifndef FILE_VERSION
  !error "FILE_VERSION is required"
!endif
!ifndef IS_BETA
  !error "IS_BETA is required"
!endif

!if ${IS_BETA} == 1
  !define ORBIT_SETUP_NAME "ORBIT Beta Xbox Mode"
  !define ORBIT_RELEASE_KIND "beta"
  !define ORBIT_CAPABILITY_KIND "community-beta"
!else
  !define ORBIT_SETUP_NAME "ORBIT Xbox Mode"
  !define ORBIT_RELEASE_KIND "release"
  !define ORBIT_CAPABILITY_KIND "Gaming Home"
!endif

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

Var OrbitPowerShell
Var OrbitParameters
Var OrbitUpdateMode

Name "${ORBIT_SETUP_NAME}"
Caption "${ORBIT_SETUP_NAME} Setup"
OutFile "${OUTPUT_PATH}"
InstallDir "$LOCALAPPDATA\Programs\ORBIT Xbox Mode"
BrandingText "ORBIT ${DISPLAY_VERSION} - Gaming Home"
ShowInstDetails show
AutoCloseWindow false

Function .onInit
  StrCpy $OrbitUpdateMode "0"
  ${GetParameters} $OrbitParameters
  ${GetOptions} $OrbitParameters "/ORBIT-UPDATE=" $0
  ${If} $0 == "1"
    StrCpy $OrbitUpdateMode "1"
    SetSilent silent
  ${EndIf}
FunctionEnd

VIProductVersion "${FILE_VERSION}"
VIAddVersionKey /LANG=1033 "ProductName" "ORBIT Xbox Mode"
VIAddVersionKey /LANG=1033 "FileDescription" "ORBIT Xbox Mode Setup"
  VIAddVersionKey /LANG=1033 "CompanyName" "Open Source Developer Luis Antonio Garcia Roque"
VIAddVersionKey /LANG=1033 "FileVersion" "${FILE_VERSION}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${DISPLAY_VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright 2026 Luis Garcia"

!define MUI_ICON "${ORBIT_ROOT}\build\installerIcon.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "${ORBIT_ROOT}\build\installerHeader.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${ORBIT_ROOT}\build\installerSidebar.bmp"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "ORBIT ${DISPLAY_VERSION} Xbox Mode"
  !define MUI_WELCOMEPAGE_TEXT "This setup installs the ORBIT ${ORBIT_RELEASE_KIND} as a Windows Gaming Home app.$\r$\n$\r$\nAfter administrator approval it validates the complete package contract and publicly trusted Certum signature, enables Developer Mode for the ${ORBIT_CAPABILITY_KIND} capability, and installs the signed AppX for this Windows account. A legacy self-signed ORBIT package is retained so Windows does not delete its package-family-scoped data."
!define MUI_FINISHPAGE_TITLE "ORBIT is installed for Xbox Mode"
!define MUI_FINISHPAGE_TEXT "Windows Xbox Mode settings will open next. Under Choose home app, select ORBIT."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

Section "Install ORBIT Xbox Mode" SEC_MAIN
  SetDetailsPrint both
  SetOutPath "$PLUGINSDIR"
  File /oname=ORBIT.appx "${APPX_PATH}"
  File /oname=ORBIT-Code-Signing.cer "${CERT_PATH}"
  File /oname=Install-OrbitXboxMode.ps1 "${INSTALL_SCRIPT_PATH}"

  ${If} $OrbitUpdateMode == "1"
    DetailPrint "Updating the ORBIT Gaming Home package..."
  ${Else}
    DetailPrint "Installing the ORBIT Gaming Home package..."
  ${EndIf}
  StrCpy $OrbitPowerShell "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${RunningX64}
    ; NSIS is a 32-bit process. Sysnative bypasses file-system redirection and
    ; guarantees the 64-bit Appx PowerShell module used by Add-AppxPackage.
    StrCpy $OrbitPowerShell "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
  DetailPrint "Using 64-bit PowerShell: $OrbitPowerShell"
  ${If} $OrbitUpdateMode == "1"
    nsExec::ExecToLog '"$OrbitPowerShell" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\Install-OrbitXboxMode.ps1" -PackagePath "$PLUGINSDIR\ORBIT.appx" -CertificatePath "$PLUGINSDIR\ORBIT-Code-Signing.cer" -UpdateOnly -Launch'
  ${Else}
    nsExec::ExecToLog '"$OrbitPowerShell" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\Install-OrbitXboxMode.ps1" -PackagePath "$PLUGINSDIR\ORBIT.appx" -CertificatePath "$PLUGINSDIR\ORBIT-Code-Signing.cer" -OpenSettings'
  ${EndIf}
  Pop $0
  ${If} $0 != 0
    ${If} $OrbitUpdateMode != "1"
      MessageBox MB_ICONSTOP|MB_OK "ORBIT Xbox Mode setup failed with exit code $0. See the installation log for details."
    ${EndIf}
    SetErrorLevel $0
    Abort
  ${EndIf}
SectionEnd
