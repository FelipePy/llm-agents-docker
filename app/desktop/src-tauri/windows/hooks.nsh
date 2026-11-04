; Ganchos do instalador NSIS (.exe) do Jarvis. Valem para o instalador e para o
; uninstall.exe, que o instalador grava (e que roda tambem numa atualizacao com
; "Uninstall before installing").
;
; Antes de copiar ou apagar arquivos, o Tauri pergunta ao Restart Manager do
; Windows quem esta usando o executavel e tenta encerrar esse processo; se nao
; consegue, aborta com "Jarvis is running" / "Failed to kill Jarvis". Dois casos:
;
; - O proprio Jarvis: fechar a janela so o esconde na bandeja (ele continua
;   ouvindo), entao o pedido de fechar nao basta. Encerramos o processo (e os
;   filhos: WebView2 e wsl.exe) de vez.
; - Um antivirus (visto com o McAfee, servico mc-fw-host) com o executavel
;   aberto: processo critico, que nao pode ser encerrado. Tiramos o executavel
;   antigo do caminho (renomear funciona mesmo com ele aberto); sem o arquivo,
;   ninguem o esta usando e a verificacao passa.

!macro KILL_JARVIS
  nsExec::ExecToLog 'taskkill /F /T /IM "${MAINBINARYNAME}.exe"'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM "Jarvis.exe"'
  Pop $0
  Sleep 1000
!macroend

!macro MOVE_OLD_EXE
  Delete "$INSTDIR\${MAINBINARYNAME}.exe.old"
  ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    ClearErrors
    Rename "$INSTDIR\${MAINBINARYNAME}.exe" "$INSTDIR\${MAINBINARYNAME}.exe.old"
    ${If} ${Errors}
      DetailPrint "Nao consegui renomear ${MAINBINARYNAME}.exe (arquivo em uso)."
    ${Else}
      ; Se o antivirus ainda o segura, o Windows o apaga quando ele soltar o arquivo;
      ; se nem isso der, a proxima instalacao apaga (Delete acima).
      Delete "$INSTDIR\${MAINBINARYNAME}.exe.old"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KILL_JARVIS
  !insertmacro MOVE_OLD_EXE
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KILL_JARVIS
  !insertmacro MOVE_OLD_EXE
!macroend

; O Tauri so remove a pasta se ela estiver vazia: um .old que sobrou a impediria.
!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\${MAINBINARYNAME}.exe.old"
  RMDir "$INSTDIR"
!macroend
