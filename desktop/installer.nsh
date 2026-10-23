!include "FileFunc.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
Function PagePortNormalizeDirectory
  trim_directory:
  StrCpy $R9 "$INSTDIR" 1 -1
  ${If} $R9 == "\"
    StrCpy $INSTDIR "$INSTDIR" -1
    Goto trim_directory
  ${EndIf}
  ${GetFileName} "$INSTDIR" $R9
  ${If} $R9 != "PagePort"
    StrCpy $INSTDIR "$INSTDIR\PagePort"
  ${EndIf}
FunctionEnd

!macro customInit
  Call PagePortNormalizeDirectory
!macroend

Function PagePortDirectoryPage
  Call PagePortNormalizeDirectory
  Abort
FunctionEnd

!macro customPageAfterChangeDir
  Page custom PagePortDirectoryPage
!macroend
!endif
