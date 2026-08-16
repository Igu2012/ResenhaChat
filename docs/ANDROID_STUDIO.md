# Resenha Chat no Android Studio

A APK usa Capacitor para empacotar a mesma interface React do Resenha Chat. O visual e a estrutura da versão web permanecem compartilhados; a camada Android acrescenta APIs nativas, como notificações push e captura de tela por MediaProjection.

## Pré-requisitos

Instale Node.js 22 ou superior, pnpm, Android Studio com Android SDK e um dispositivo ou emulador Android. No projeto, execute `pnpm install` e depois `pnpm build:android`. O comando gera `dist/public` e sincroniza a interface para a pasta `android`.

Abra a pasta `android` no Android Studio. Para gerar uma APK de teste, use **Build → Build Bundle(s) / APK(s) → Build APK(s)**. Para uma versão de distribuição, configure uma chave de assinatura no Android Studio e use **Build → Generate Signed App Bundle or APK**. O arquivo `google-services.json`, quando utilizado pelo Firebase Android, deve ficar em `android/app/` e não deve ser commitado.

## Configuração do servidor Render

Nenhum segredo deve ser colocado no repositório público. No Render, abra o serviço Web → **Environment → Environment Variables** e adicione os nomes abaixo. Os valores devem ser copiados diretamente do Firebase Console.

| Variável | Uso | Obrigatória |
|---|---|---|
| `FIREBASE_PROJECT_ID` | Identificação do projeto Firebase | Para autenticação |
| `FIREBASE_WEB_API_KEY` | Intermedia cadastro e login por nome de usuário | Para autenticação |
| `FIREBASE_MESSAGING_SENDER_ID` | Identificação do FCM | Para push |
| `FIREBASE_APP_ID` | Identificação do app Firebase | Para integração |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | JSON privado da conta de serviço usado pelo Firebase Admin/FCM | Para push com app fechado |

Para obter a conta de serviço, abra **Firebase Console → Configurações do projeto → Contas de serviço → Gerar nova chave privada**. Cole o JSON inteiro em `FIREBASE_SERVICE_ACCOUNT_JSON` no Render, preservando as aspas e os caracteres `\\n` da chave privada. Nunca coloque esse JSON em `client/`, `android/`, no GitHub ou em uma mensagem pública.

Antes de criar contas oficiais, ative **Authentication → Sign-in method → E-mail/Password** no Firebase. O Resenha Chat usa um endereço interno derivado do nome de usuário, portanto o usuário escolhe apenas nome de usuário e senha. A senha é processada e armazenada pelo Firebase Authentication; o Resenha Chat não grava a senha em texto puro.

## Firebase Cloud Messaging

A APK solicita a permissão de notificações, registra o token FCM e o envia pelo Socket.io autenticado. O servidor mantém somente os tokens em memória e usa `FIREBASE_SERVICE_ACCOUNT_JSON` para enviar avisos de mensagens, chamadas e solicitações. Sem a conta de serviço configurada, o chat continua funcionando, mas o push remoto não será enviado. Como os tokens ficam em RAM, um reinício do Render exige que o aplicativo seja aberto novamente para registrar o token de notificação.

No Android, o aplicativo também precisa ter o app Android cadastrado no Firebase com o mesmo application ID `com.resenhachat.app`. Baixe o `google-services.json` desse app, coloque-o em `android/app/` localmente e execute `pnpm build:android`. Esse arquivo permanece ignorado pelo Git.

## Atualizações

A APK consulta `https://api.github.com/repos/Igu2012/redesocial/releases/latest` ao abrir. Publique uma GitHub Release com uma tag semântica maior que a instalada, por exemplo `v1.0.1`, e anexe uma APK assinada ao release. A versão deve ser incrementada de forma coerente em `package.json`, em `client/src/lib/nativeRuntime.ts` (`APP_VERSION`) e em `android/app/build.gradle` (`versionCode` e `versionName`). Ao encontrar uma release nova, o aplicativo abre o download; a instalação ainda exige a confirmação padrão do Android e, em alguns aparelhos, a autorização de instalação de fontes permitidas. Para distribuição ampla, prefira publicar um Android App Bundle na Google Play, pois a Play Store gerencia atualizações e assinatura com mais segurança.

## Compartilhamento de tela nativo

Na APK, o botão de compartilhar tela usa a ponte `NativeScreenSharePlugin`. Ela solicita o consentimento do Android pelo `MediaProjectionManager`, mantém um serviço em primeiro plano enquanto a tela está sendo transmitida e captura a virtual display nativamente. Os frames são limitados a aproximadamente 2,4 fps e enviados ao canvas do WebView, que os encaminha como track pela chamada WebRTC existente. Esse limite reduz uso de bateria e memória em aparelhos intermediários; a qualidade é apropriada para acompanhar interfaces, não para vídeo de alta taxa.

Teste em um **aparelho Android físico**: entre em uma chamada, toque no ícone de tela, escolha o conteúdo quando o diálogo do sistema abrir e verifique se o outro participante vê o selo `LIVE`. Encerre pelo mesmo botão ou pela chamada. O navegador móvel comum continua sem esse controle; o recurso existe apenas na APK. Em Android 14 ou superior, não remova as permissões `FOREGROUND_SERVICE` e `FOREGROUND_SERVICE_MEDIA_PROJECTION` nem a declaração do `ScreenProjectionService` do `AndroidManifest.xml`.

## Limites importantes

A leitura de mensagens já persistidas funciona sem internet. Mensagens novas, solicitações e chamadas precisam de rede. Solicitações e mensagens pendentes só permanecem disponíveis enquanto o processo do Render estiver em execução, pois o diretório e as filas do projeto são propositalmente mantidos em RAM para caber no plano de 512 MB.

Cada dispositivo cria uma chave ECDH P-256 privada no armazenamento local e publica somente a chave pública. Antes do envio, texto e anexo são embalados com AES-GCM em um envelope exclusivo para cada destinatário; o servidor encaminha o envelope sem ter a chave privada. Apagar os dados do navegador, trocar de dispositivo ou perder o armazenamento local impede abrir mensagens protegidas destinadas à chave anterior. A primeira troca de chave não tem verificação manual de identidade nesta versão, portanto os participantes devem confirmar a identidade do contato por outro canal antes de compartilhar informações altamente sensíveis.
