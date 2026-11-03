; Ganchos do instalador NSIS (.exe) do Jarvis.
;
; O Jarvis nao fecha quando pedem: fechar a janela so o esconde na bandeja (ele
; continua ouvindo). O instalador pede para ele fechar pelo Restart Manager do
; Windows, o pedido vira "esconder" e a atualizacao falhava com "Failed to kill
; Jarvis". Antes de instalar ou desinstalar, encerra o processo (e os filhos:
; WebView2 e wsl.exe) de vez.

!macro KILL_JARVIS
  nsExec::Exec 'taskkill /F /T /IM "${MAINBINARYNAME}.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM "Jarvis.exe"'
  Pop $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KILL_JARVIS
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KILL_JARVIS
!macroend
