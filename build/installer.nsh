!macro customHeader
  BrandingText "${PRODUCT_NAME} ${VERSION} - Console-first gaming"
  !define MUI_ABORTWARNING
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend
