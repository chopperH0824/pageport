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

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif

  Function PagePortScheduleDeleteInstaller
    !ifdef APP_INSTALLER_STORE_FILE
      Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    !endif
    ${If} $EXEPATH != ""
    ${AndIf} ${FileExists} "$EXEPATH"
      SetOutPath "$TEMP"
      System::Call 'kernel32::SetEnvironmentVariableW(w "PAGEPORT_INSTALLER_EXE", w "$EXEPATH")'
      ExecShell "" "$SYSDIR\cmd.exe" '/v:on /d /c for /L %i in (1,1,15) do @(if exist "!PAGEPORT_INSTALLER_EXE!" (del /f /q "!PAGEPORT_INSTALLER_EXE!" >nul 2>nul & if exist "!PAGEPORT_INSTALLER_EXE!" ping 127.0.0.1 -n 2 >nul))' SW_HIDE
      SetOutPath "$INSTDIR"
    ${EndIf}
  FunctionEnd

  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "安装完成后删除安装包"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "PagePortScheduleDeleteInstaller"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW "PagePortFinishPageShow"
  !insertmacro MUI_PAGE_FINISH

  Function PagePortFinishPageShow
    ${StdUtils.TestParameter} $R9 "keep-installer"
    ${If} $R9 == "true"
      SendMessage $mui.FinishPage.ShowReadme ${BM_SETCHECK} ${BST_UNCHECKED} 0
    ${EndIf}
  FunctionEnd
!macroend

!macro customInstall
  ${If} ${Silent}
    ${StdUtils.TestParameter} $R9 "delete-installer"
    ${If} $R9 == "true"
      Call PagePortScheduleDeleteInstaller
    ${EndIf}
  ${EndIf}
!macroend
!endif
