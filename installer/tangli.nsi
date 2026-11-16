Unicode True
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Name "塘里"
OutFile "${TANGLI_SETUP}"
InstallDir "$LOCALAPPDATA\Programs\Tangli"
InstallDirRegKey HKCU "Software\TangliDesktopPond" "InstallDir"
RequestExecutionLevel user
SetCompress off
ShowInstDetails show
ShowUninstDetails show

!define MUI_ICON "${TANGLI_ICON}"
!define MUI_UNICON "${TANGLI_ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\塘里.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动塘里"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Var ProgramsPath
Var RegistryKey
Var ProductKey
Var TestParent

!macro ConfigurePaths
  SetShellVarContext current
  StrCpy $ProgramsPath "$SMPROGRAMS\塘里"
  StrCpy $RegistryKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\TangliDesktopPond"
  StrCpy $ProductKey "Software\TangliDesktopPond"
  StrCpy $TestParent ""
  ; Smoke tests use a private shortcut directory and registry key.
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/TANGLI_TEST_ROOT=" $R1
  ${IfNot} ${Errors}
    StrCpy $ProgramsPath "$R1\Programs\塘里"
    ClearErrors
    ${GetOptions} $R0 "/TANGLI_TEST_ID=" $R2
    ${If} ${Errors}
      Abort
    ${EndIf}
    StrCpy $TestParent "Software\TangliDesktopPondSmoke\$R2"
    StrCpy $RegistryKey "$TestParent\Uninstall"
    StrCpy $ProductKey "$TestParent\Product"
  ${EndIf}
!macroend

Function .onInit
  !insertmacro ConfigurePaths
FunctionEnd

Function un.onInit
  !insertmacro ConfigurePaths
FunctionEnd

Section "塘里"
  SetOutPath "$INSTDIR"
  SetOverwrite on
  IfFileExists "$INSTDIR\.tangli-install-previous.exe" 0 backupClear
    IfSilent +2 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "发现尚未恢复的旧版备份，请检查安装目录后重试。"
    SetErrorLevel 1
    Abort
  backupClear:
  ClearErrors
  File "/oname=.tangli-install-next.exe" "${TANGLI_PORTABLE}"
  ${If} ${Errors}
    IfSilent +2 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "无法写入程序文件，请检查磁盘空间和目录权限。"
    SetErrorLevel 1
    Abort
  ${EndIf}
  IfFileExists "$INSTDIR\塘里.exe" 0 installNew
    ClearErrors
    Rename "$INSTDIR\塘里.exe" "$INSTDIR\.tangli-install-previous.exe"
    ${If} ${Errors}
      Delete "$INSTDIR\.tangli-install-next.exe"
      IfSilent +2 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "请先退出正在运行的塘里，再重新安装。"
      SetErrorLevel 1
      Abort
    ${EndIf}
  installNew:
  ClearErrors
  Rename "$INSTDIR\.tangli-install-next.exe" "$INSTDIR\塘里.exe"
  ${If} ${Errors}
    IfFileExists "$INSTDIR\.tangli-install-previous.exe" 0 +2
      Rename "$INSTDIR\.tangli-install-previous.exe" "$INSTDIR\塘里.exe"
    SetErrorLevel 1
    Abort
  ${EndIf}
  Delete "$INSTDIR\.tangli-install-previous.exe"
  FileOpen $0 "$INSTDIR\tangli-install.marker" w
  FileWrite $0 "Tangli installation"
  FileClose $0
  WriteUninstaller "$INSTDIR\卸载塘里.exe"
  CreateDirectory "$ProgramsPath"
  ClearErrors
  CreateShortcut "$ProgramsPath\塘里.lnk" "$INSTDIR\塘里.exe" "" "$INSTDIR\塘里.exe" 0
  ${If} ${Errors}
    IfSilent +2 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "无法创建开始菜单快捷方式，请检查权限后重试。"
    SetErrorLevel 1
    Abort
  ${EndIf}
  WriteRegStr HKCU "$ProductKey" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "$RegistryKey" "DisplayName" "塘里"
  WriteRegStr HKCU "$RegistryKey" "DisplayVersion" "${TANGLI_VERSION}"
  WriteRegStr HKCU "$RegistryKey" "DisplayIcon" "$INSTDIR\塘里.exe"
  WriteRegStr HKCU "$RegistryKey" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "$RegistryKey" "UninstallString" '"$INSTDIR\卸载塘里.exe"'
  WriteRegDWORD HKCU "$RegistryKey" "NoModify" 1
  WriteRegDWORD HKCU "$RegistryKey" "NoRepair" 1
SectionEnd

Section "Uninstall"
  ; Only remove this installation's known files. Pond settings are retained.
  ClearErrors
  Delete "$INSTDIR\塘里.exe"
  ${If} ${Errors}
    IfSilent +2 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "请先退出塘里，再运行卸载程序。"
    SetErrorLevel 1
    Abort
  ${EndIf}
  Delete "$INSTDIR\tangli-install.marker"
  Delete "$INSTDIR\卸载塘里.exe"
  ReadRegStr $0 HKCU "$RegistryKey" "InstallLocation"
  ${If} $0 == $INSTDIR
    Delete "$ProgramsPath\塘里.lnk"
    RMDir "$ProgramsPath"
    DeleteRegKey HKCU "$RegistryKey"
    DeleteRegKey HKCU "$ProductKey"
    ${If} $TestParent != ""
      DeleteRegKey /ifempty HKCU "$TestParent"
      DeleteRegKey /ifempty HKCU "Software\TangliDesktopPondSmoke"
    ${EndIf}
  ${EndIf}
  RMDir "$INSTDIR"
SectionEnd
