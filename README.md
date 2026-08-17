# Resenha Chat — Cliente

Este repositório contém exclusivamente o **cliente estático** do Resenha Chat, destinado ao deploy no Vercel e ao build da APK Android. A API, Socket.io, Firebase, Klipy e demais variáveis privadas operam no serviço Render em `https://resenhudochat.onrender.com` e não fazem parte deste repositório público.

## Vercel

Importe este repositório no Vercel. A configuração `vercel.json` já executa `pnpm build`, publica `dist/public` e redireciona rotas da SPA para `index.html`. O cliente usa `https://resenhudochat.onrender.com` como origem padrão da API e do Socket.io. Caso necessário, defina `VITE_RESENHA_SERVER_URL` com essa mesma URL, sem barra ao final.

## Android e releases

Execute `pnpm install`, depois `pnpm build:android`; abra a pasta `android/` no Android Studio ou execute `./gradlew assembleDebug` dentro dela. O arquivo resultante se chama `ResenhaChat.apk`. Publique-o como asset de uma GitHub Release neste repositório, pois a APK consulta este repositório para encontrar atualizações.

## iPhone

No iPhone, abra o site no Safari e use **Compartilhar → Adicionar à Tela de Início** para instalar o aplicativo web. O fluxo para TestFlight e uma futura IPA nativa está em [IOS_DISTRIBUTION.md](./IOS_DISTRIBUTION.md).
