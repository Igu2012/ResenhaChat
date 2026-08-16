# Auditoria de ícones Android

Em 16 de agosto de 2026, o recurso `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` foi verificado visualmente e identificado como o ícone padrão do Capacitor. Em seguida, ele foi substituído pelo ativo de marca disponível no projeto, com máscara circular, por meio de `scripts/generate_android_icons.py`.

O ativo-fonte é `client/public/favicon.png`. O gerador produz `ic_launcher.png`, `ic_launcher_round.png` e `ic_launcher_foreground.png` em todas as cinco densidades Android, preservando a forma circular solicitada. A APK debug foi recompilada com sucesso após essa geração.

| Densidade | SHA-256 de `ic_launcher.png` |
|---|---|
| mdpi | `30d3d10a67128b9a0cdaf2bcdc98c7b3d4684a4e3e012a37e241131769e80be9` |
| hdpi | `4d33e0090d061984f4b74f595451d0925e6ce38db138e2f77f6fac710e43dc6b` |
| xhdpi | `955e95093a838f9e7358b46d659fcebf70a63a64314e9d03a8a396cc2e148010` |
| xxhdpi | `96ec371bd4832c9abd18ae94d39ed112d8e827c20eef886c0f4c94f3c298cde3` |
| xxxhdpi | `af3b3a6d9d3d682525b4b2a3399c7c806c22595f3f729a3f09d2f2b6228b6d3e` |
