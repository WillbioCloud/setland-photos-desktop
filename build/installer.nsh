!macro customInit
  ; Habilita a leitura do registro de 64 bits para detectar o Visual C++ 2015-2022 x64
  SetRegView 64
  ClearErrors
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ${If} ${Errors}
  ${OrIf} $0 != 1
    SetRegView 32
    ClearErrors
    ReadRegDWORD $1 HKLM "SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    ${If} ${Errors}
    ${OrIf} $1 != 1
      ; Se o Visual C++ x64 não estiver instalado, extrai e executa o instalador oficial
      InitPluginsDir
      File /oname=$PLUGINSDIR\vc_redist.x64.exe "${BUILD_RESOURCES_DIR}\vc_redist.x64.exe"
      ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /passive /norestart'
    ${EndIf}
  ${EndIf}
  SetRegView default
!macroend

