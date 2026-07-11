; ChangLi NSIS Custom Installer Script
; 安装 WebView2 运行时

!macro installWebview2
  ; 检查 WebView2 是否已安装
  nsExec::ExecToStack 'reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BEB-235B0DB71093}" /v pv'
  Pop $0
  ${If} $0 != 0
    ; WebView2 未安装，执行静默安装
    DetailPrint "正在安装 WebView2 运行时..."
    nsExec::ExecToStack '"$INSTDIR\resources\webview2\MicrosoftEdgeWebview2Setup.exe" /silent /install'
    Pop $0
    ${If} $0 == 0
      DetailPrint "WebView2 安装完成"
    ${Else}
      DetailPrint "WebView2 安装失败（错误码：$0），请手动安装"
    ${EndIf}
  ${Else}
    DetailPrint "WebView2 已安装，跳过"
  ${EndIf}
!macroend

; 禁用程序兼容性助手（PCA）
!macro disablePCA
  WriteRegStr HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\${_FILE}.exe" "WIN10RTMRTM"
!macroend
