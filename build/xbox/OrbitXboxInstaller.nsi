Unicode true
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 32

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

Var OrbitPowerShell

Name "ORBIT Xbox Mode"
Caption "ORBIT Xbox Mode Setup"
OutFile "${OUTPUT_PATH}"
InstallDir "$LOCALAPPDATA\Programs\ORBIT Xbox Mode"
BrandingText "ORBIT 0.0.0.3 - Gaming Home"
ShowInstDetails show
AutoCloseWindow false

VIProductVersion "0.0.0.3"
VIAddVersionKey /LANG=1033 "ProductName" "ORBIT Xbox Mode"
VIAddVersionKey /LANG=1033 "FileDescription" "ORBIT Xbox Mode Setup"
VIAddVersionKey /LANG=1033 "CompanyName" "ORBIT Development"
VIAddVersionKey /LANG=1033 "FileVersion" "0.0.0.3"
VIAddVersionKey /LANG=1033 "ProductVersion" "0.0.0.3"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright 2026 Luis Garcia"

!define MUI_ICON "${ORBIT_ROOT}\build\installerIcon.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "${ORBIT_ROOT}\build\installerHeader.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${ORBIT_ROOT}\build\installerSidebar.bmp"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "ORBIT Xbox Mode"
!define MUI_WELCOMEPAGE_TEXT "This setup installs ORBIT as a Windows Gaming Home app.$\r$\n$\r$\nIt trusts only the bundled ORBIT development certificate in Local Machine\Trusted People, enables Developer Mode for the SCCD capability, and installs the signed AppX package."
!define MUI_FINISHPAGE_TITLE "ORBIT is ready for Xbox Mode"
!define MUI_FINISHPAGE_TEXT "Open Windows Settings > Gaming > Xbox mode > Choose home app and select ORBIT."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "German"
!insertmacro MUI_LANGUAGE "English"

Section "Install ORBIT Xbox Mode" SEC_MAIN
  SetDetailsPrint both
  SetOutPath "$PLUGINSDIR"
  File /oname=ORBIT.appx "${APPX_PATH}"
  File /oname=ORBIT-Development.cer "${CERT_PATH}"
  File /oname=Install-OrbitXboxMode.ps1 "${INSTALL_SCRIPT_PATH}"

  DetailPrint "Installing the ORBIT Gaming Home package..."
  StrCpy $OrbitPowerShell "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${RunningX64}
    ; NSIS is a 32-bit process. Sysnative bypasses file-system redirection and
    ; guarantees the 64-bit Appx PowerShell module used by Add-AppxPackage.
    StrCpy $OrbitPowerShell "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
  DetailPrint "Using 64-bit PowerShell: $OrbitPowerShell"
  nsExec::ExecToLog '"$OrbitPowerShell" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\Install-OrbitXboxMode.ps1" -PackagePath "$PLUGINSDIR\ORBIT.appx" -CertificatePath "$PLUGINSDIR\ORBIT-Development.cer"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "ORBIT Xbox Mode setup failed with exit code $0. See the installation log for details."
    SetErrorLevel $0
    Abort
  ${EndIf}
SectionEnd
