# Compartilhamento de tela Android: decisão técnica

O compartilhamento de tela por uma APK Capacitor não pode depender apenas de `getDisplayMedia()` no WebView. A implementação robusta precisa solicitar consentimento pelo `MediaProjectionManager` do Android e converter a projeção em uma fonte de vídeo WebRTC nativa antes de encaminhá-la à chamada. A documentação oficial descreve a projeção como captura do conteúdo da tela para uma virtual display, com consentimento por sessão. [Android Developers: Media projection](https://developer.android.com/media/grow/media-projection)

> A etapa de captura e a etapa de transporte WebRTC são distintas: o token do `MediaProjection` autoriza a captura, mas não cria automaticamente uma `MediaStream` JavaScript no WebView.

Na versão atual, a APK usa `NativeScreenSharePlugin`: ele inicia um serviço em primeiro plano, solicita consentimento com `MediaProjectionManager`, captura uma virtual display via `ImageReader` e entrega frames JPEG de baixa taxa ao WebView. O WebView os desenha em um canvas e usa `canvas.captureStream()` como track na conexão WebRTC já existente. Navegadores móveis continuam sem botão de tela. A implementação prioriza compatibilidade e consumo previsível no dispositivo, com taxa limitada a aproximadamente 2,4 fps; não simula captura quando o consentimento é negado.
