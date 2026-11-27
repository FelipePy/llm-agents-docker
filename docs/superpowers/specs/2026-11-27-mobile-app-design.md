# Jarvis no celular (Android)

## Objetivo
Usar o Jarvis do PC pelo celular, fora de casa, com tudo o que a interface do PC tem: voz ao vivo (com interrupção),
cartões, terminais, configurações. O PC fica ligado com o servidor do Jarvis rodando.

## Decisões
- **Transporte: Tailscale**, não Telegram. O Telegram não leva áudio ao vivo nem terminal, e um app mandando mensagens
  por ele teria que entrar na conta do usuário. O Tailscale liga celular e PC numa rede privada, sem porta aberta.
- **HTTPS pelo `tailscale serve`**: o microfone (`getUserMedia`) só funciona em contexto seguro. O `tailscale serve`
  publica `https://<pc>.<tailnet>.ts.net` só dentro da tailnet, com certificado válido, e repassa para
  `http://127.0.0.1:7777`. O servidor continua ouvindo só em `127.0.0.1` (no Windows, o WSL repassa o `localhost`).
- **App Android nativo e pequeno** (Kotlin, uma Activity com WebView), não Tauri mobile: sem Rust nem NDK, e o CI já
  tem o SDK do Android. A interface é a mesma do PC (`app/web`), servida pelo próprio servidor.

## Partes
1. **Servidor (`remote.ts`)**: acha o `tailscale` (no WSL, o `tailscale.exe` do Windows), lê o estado
   (`tailscale status --json`, `tailscale serve status --json`), liga e desliga o `serve` para a porta da interface.
   A origem `https://<nome>.ts.net` entra na lista de origens aceitas. Rotas `GET /api/remote` e `PUT /api/remote`
   (com token, como as outras). O link de conexão (`https://<nome>/#token=…`) só sai com o acesso ligado.
2. **Interface**: seção "Acesso pelo celular" nas configurações: passo a passo, botão para ligar/desligar e o QR code
   do link (mostrado só quando pedido, porque dá acesso ao Jarvis). Layout para tela estreita.
3. **App (`app/android`)**: primeira tela lê o QR (scanner do Google Play services, sem permissão de câmera) ou aceita o
   link colado; guarda o link; abre a interface na WebView, libera o microfone (`RECORD_AUDIO`) e mantém a tela acesa
   enquanto a voz estiver ligada. Botão para trocar o PC.
4. **CI**: workflow `android` que gera o APK, só quando o usuário pede (`workflow_dispatch`), e a compilação do app
   nas verificações de push.

## Fora desta etapa
- Palavra de ativação com o app fechado (serviço em segundo plano).
- iPhone.
- Acordar o PC (Wake-on-LAN).
