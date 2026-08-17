# Distribuição no iPhone

## Situação atual

O **Resenha Chat** já pode ser instalado no iPhone como aplicativo web. Ao abrir o site no Safari, o aviso de instalação explica o caminho correto: **Compartilhar → Adicionar à Tela de Início**. A Apple documenta esse fluxo para transformar um site em app web no iPhone.[1]

O site também está preparado para uma distribuição nativa no futuro. Quando existir uma URL de instalação iPhone, defina no Vercel a variável pública abaixo:

```text
VITE_IOS_INSTALL_URL=https://seu-link-testflight-ou-distribuicao-ios
```

Com essa variável configurada, iPhones serão direcionados a ela. Sem a variável — ou sem uma IPA na GitHub Release — o botão mostra as instruções de instalação web, em vez de oferecer um arquivo que não seria instalável.

## Por que não há uma IPA nesta release

> Uma APK Android pode ser assinada e gerada no ambiente Linux. Para uma **IPA iOS**, a Apple exige um projeto aberto no Xcode em um Mac e ativos de assinatura vinculados a uma conta Apple Developer.

Para distribuir uma build limitada a aparelhos conhecidos, a Apple requer um App ID, certificado de distribuição, lista de aparelhos registrados e um perfil de provisionamento.[2] Isso impede criar uma IPA instalável corretamente neste ambiente Linux sem um Mac, Xcode e a conta Apple Developer.

| Objetivo | Caminho recomendado | Link que deve entrar em `VITE_IOS_INSTALL_URL` |
|---|---|---|
| Seu amigo usar já | Abrir `https://resenhachat.vercel.app` no Safari e adicionar à Tela de Início | Não necessário |
| Testar uma versão nativa | TestFlight com link público ou convite | Link público do TestFlight |
| Distribuição pública | Publicação na App Store | Link da App Store |
| Poucos aparelhos próprios | Ad hoc para UDIDs registrados, exportada pelo Xcode | Página de distribuição ad hoc autorizada |

## Próximo processo para uma IPA nativa

Em um Mac com Xcode, adicione o alvo iOS do Capacitor, configure o mesmo identificador do aplicativo, escolha a equipe Apple Developer e execute o build de archive. Depois, envie-o para o App Store Connect e use TestFlight. A Apple permite criar um grupo externo e compartilhar um link público de teste depois que a build estiver elegível; os testadores entram usando o aplicativo TestFlight.[3]

Após obter o link público do TestFlight, configure `VITE_IOS_INSTALL_URL` no projeto Vercel e faça um novo deploy. A interface do site passará a exibir **“Instale o app no iPhone”** e abrirá esse destino somente em iPhones/iPads.

## Referências

[1] [Apple Support — Turn a website into an app in Safari on iPhone](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)

[2] [Apple Developer — Distributing your app to registered devices](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices)

[3] [Apple Developer — Invite external testers with TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/)
