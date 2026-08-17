# Chamadas Android em Segundo Plano

O Android exige uma notificação visível enquanto um **foreground service** executa uma atividade perceptível ao usuário. Para chamadas de voz/vídeo, o serviço deve declarar somente os tipos necessários, como `microphone` e, quando usado, `camera`; no Android 14+ isso também exige as permissões específicas de foreground service no manifesto. O microfone e a câmera precisam ser iniciados enquanto o app está visível, após o usuário conceder as permissões de execução.

Não é necessário usar a permissão de sobreposição (`SYSTEM_ALERT_WINDOW`) para manter uma chamada ativa. Ela não substitui um foreground service e será removida do fluxo da chamada. O app deve manter uma notificação de chamada ativa e parar o serviço quando a ligação terminar.

O Android pode encerrar processos quando o usuário força a parada do app nas configurações. Remover o app da lista de recentes tem comportamento variável por fabricante; um serviço foreground iniciado corretamente e retornando `START_STICKY` melhora a continuidade, mas não permite contornar uma parada forçada pelo usuário ou políticas agressivas de bateria.

## Fontes

- [Android Developers — Foreground services overview](https://developer.android.com/develop/background-work/services/fgs)
- [Android Developers — Foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types)
- [Android Developers — Android 14 foreground service requirements](https://developer.android.com/about/versions/14/changes/fgs-types-required)
