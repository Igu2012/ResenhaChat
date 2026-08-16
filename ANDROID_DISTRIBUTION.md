# Distribuição Android e assinatura do Resenha Chat

## Estado da release assinada

A versão **1.0.7** é uma release de compatibilidade. Ela usa o mesmo certificado encontrado na APK `v1.0.5` já instalada, permitindo que o Android atualize o aplicativo sem exigir desinstalação e sem apagar os dados locais. A configuração de assinatura lê os dados em `android/keystore.properties`, arquivo que é ignorado pelo Git, e o projeto inclui somente o modelo `android/keystore.properties.example`.

> Nunca envie o arquivo `.jks`, `android/keystore.properties` ou qualquer senha para o GitHub. O Android exige a mesma identidade de assinatura para permitir atualizações diretas da mesma aplicação. [1]

| Item | Valor |
|---|---|
| Identificador Android | `com.resenhachat.app` |
| Release de compatibilidade | `v1.0.7` (`versionCode` 8) |
| Nome de distribuição | `ResenhaChat.apk` |
| Assinatura verificada | APK Signature Scheme v2 |

## Instalação de transição

A APK `v1.0.6` foi assinada com um certificado novo e, por isso, **não atualiza diretamente** a `v1.0.5`. A `v1.0.7` foi assinada com o certificado da `v1.0.5` e deve ser instalada **por cima** dela. Essa é a versão indicada para quem já tem o aplicativo instalado.

O certificado legado é um certificado de depuração e não é apropriado como identidade de produção a longo prazo. Sem Google Play, não é possível alterar novamente o certificado e ainda preservar a atualização direta dos APKs já instalados. Para migrar a uma identidade de produção sem exigir desinstalação, o caminho recomendado é configurar uma distribuição pela Google Play com Play App Signing. [1] [2]

O código de atualização compara a versão empacotada com a tag da última GitHub Release e abre o download somente uma vez para cada release.

## Como reduzir o alerta do Google Play Protect

> Um certificado próprio prova a continuidade das releases, mas não garante que uma APK baixada diretamente do GitHub deixe de ser considerada desconhecida pelo Play Protect. A mensagem da captura corresponde a uma aplicação que ainda não foi reconhecida pelo serviço.

Distribuir o app pela **Google Play** é o caminho recomendado. Crie o aplicativo na Play Console, gere um Android App Bundle (`.aab`), configure o **Play App Signing** e comece por uma faixa de teste interno. Nesse modelo, a Google protege a chave de assinatura do aplicativo e você usa uma chave de upload separada para cada envio. [1] [2]

Enquanto a distribuição continuar sendo feita pelo GitHub, mantenha somente as permissões necessárias, explique claramente câmera, microfone, notificações e sobreposição antes de solicitá-las, não inclua SDKs não auditados e preserve a assinatura de todas as releases. Para a mensagem específica de aplicativo desconhecido, a orientação oficial indica permitir a verificação pelo Play Protect; uma apelação não remove essa mensagem por si só. [3]

Se o Play Protect classificar a aplicação como potencialmente nociva ou bloqueá-la por engano após uma revisão de permissões e dependências, é possível usar o formulário oficial de apelação da Google. [3]

## Processo seguro para a próxima versão

1. Altere `package.json` e `android/app/build.gradle` para a mesma versão semântica e aumente o `versionCode`.
2. Execute `pnpm test`, `pnpm check` e `pnpm build:android`.
3. Gere a APK release com `./gradlew assembleRelease` dentro de `android`.
4. Verifique com `apksigner verify --verbose --print-certs ResenhaChat.apk`.
5. Publique somente `ResenhaChat.apk` em uma GitHub Release cuja tag corresponda à versão, por exemplo `v1.0.7`.
6. Mantenha uma cópia offline do keystore e das credenciais. A perda da chave impede a atualização de APKs assinadas fora do Play App Signing. [1]

## Referências

[1] [Android Developers — Sign your app](https://developer.android.com/studio/publish/app-signing)

[2] [Google Play Console Help — Use Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en)

[3] [Google Developers — Guidance for Google Play Protect warnings](https://developers.google.com/android/play-protect/warning-dev-guidance)
