!macro customHeader
  BrandingText "${PRODUCT_NAME} ${VERSION} - Console-first gaming"
  !define MUI_ABORTWARNING
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro orbitStopBackgroundService
  ; The executable can legitimately be absent after quarantine or a partially
  ; completed repair. In that case electron-builder's normal cleanup still runs.
  IfFileExists "$INSTDIR\${PRODUCT_FILENAME}.exe" orbit_background_shutdown_start orbit_background_shutdown_done
  orbit_background_shutdown_start:
    ClearErrors
    ExecWait '"$INSTDIR\${PRODUCT_FILENAME}.exe" orbit-background-agent-shutdown' $0
    IfErrors orbit_background_shutdown_failed
    StrCmp $0 0 orbit_background_shutdown_done
  orbit_background_shutdown_failed:
    SetErrorLevel 2
    Abort
  orbit_background_shutdown_done:
!macroend

!ifdef BUILD_UNINSTALLER
  Function un.orbitStopBackgroundServiceBeforeRemove
    !insertmacro orbitStopBackgroundService
  FunctionEnd
!endif

!macro customUnWelcomePage
  ; This callback runs only when the user advances into the non-cancellable
  ; removal page, so closing the confirmation UI never suspends the service.
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.orbitStopBackgroundServiceBeforeRemove
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customUnInit
  ; Silent update/uninstall has no page transition on which to run the callback.
  ; It is already committed, so stopping here cannot create a cancel outage.
  ${If} ${Silent}
    !insertmacro orbitStopBackgroundService
  ${EndIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Only remove an autostart value that points at this exact installation.
    ; A second ORBIT channel or moved install using the same value name is left intact.
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ORBIT Background Service"
    ; NSIS StrCmp is case-insensitive; StrCmpS would be the case-sensitive form.
    StrCmp $0 '"$INSTDIR\${PRODUCT_FILENAME}.exe" orbit-background-agent' 0 orbit_background_cleanup_done
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ORBIT Background Service"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "ORBIT Background Service"
    orbit_background_cleanup_done:
  ${endIf}
!macroend
