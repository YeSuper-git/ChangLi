; NSIS 自定义安装脚本 - 长离视频管理平台
; 中文界面 + 自动卸载旧版本

!include "MUI2.nsh"
!include "FileFunc.nsh"

; 中文语言文件
!insertmacro MUI_LANGUAGE "SimpChinese"

; 安装程序属性
Name "长离"
OutFile "ChangLi-setup.exe"
InstallDir "$PROGRAMFILES\ChangLi"
InstallDirRegKey HKLM "Software\ChangLi" "InstallDir"
RequestExecutionLevel admin

; 界面设置
!define MUI_ABORTWARNING
!define MUI_ICON "icons\icon.ico"
!define MUI_UNICON "icons\icon.ico"

; 安装页面
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; 卸载页面
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; 安装前检查并卸载旧版本
Function .onInit
  ; 检查是否已安装旧版本
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChangLi" "UninstallString"
  StrCmp $0 "" done
  
  ; 询问是否卸载旧版本
  MessageBox MB_YESNO|MB_ICONQUESTION "检测到已安装的旧版本，是否先卸载？$\n$\n点击'是'卸载旧版本，'否'取消安装。" IDYES uninstall
  Abort
  
  uninstall:
    ; 执行旧版本卸载程序
    ExecWait '$0 /S'
    
  done:
FunctionEnd

; 安装部分
Section "安装 ChangLi"
  SetOutPath "$INSTDIR"
  
  ; 安装文件
  File /r "target\release\bundle\nsis\*.*"
  
  ; 创建卸载程序
  WriteUninstaller "$INSTDIR\uninstall.exe"
  
  ; 写入注册表
  WriteRegStr HKLM "Software\ChangLi" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChangLi" "DisplayName" "长离 - 视频管理平台"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChangLi" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChangLi" "DisplayIcon" "$INSTDIR\ChangLi.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChangLi" "Publisher" "YeSuper"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChangLi" "DisplayVersion" "0.4.0"
  
  ; 创建桌面快捷方式
  CreateShortCut "$DESKTOP\长离.lnk" "$INSTDIR\ChangLi.exe"
  
  ; 创建开始菜单快捷方式
  CreateDirectory "$SMPROGRAMS\长离"
  CreateShortCut "$SMPROGRAMS\长离\长离.lnk" "$INSTDIR\ChangLi.exe"
  CreateShortCut "$SMPROGRAMS\长离\卸载长离.lnk" "$INSTDIR\uninstall.exe"
SectionEnd

; 卸载部分
Section "卸载"
  ; 删除文件
  RMDir /r "$INSTDIR"
  
  ; 删除快捷方式
  Delete "$DESKTOP\长离.lnk"
  RMDir /r "$SMPROGRAMS\长离"
  
  ; 删除注册表
  DeleteRegKey HKLM "Software\ChangLi"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChangLi"
SectionEnd
