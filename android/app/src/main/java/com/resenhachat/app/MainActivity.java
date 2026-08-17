package com.resenhachat.app;

import com.getcapacitor.BridgeActivity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(android.os.Bundle savedInstanceState) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel channel = new NotificationChannel("resenha-chat", "Mensagens da Resenha", NotificationManager.IMPORTANCE_HIGH);
      channel.setDescription("Mensagens, convites e chamadas recebidas.");
      ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);
    }
    registerPlugin(NativeScreenSharePlugin.class);
    registerPlugin(NativeCallOverlayPlugin.class);
    registerPlugin(NativeMediaPermissionPlugin.class);
    registerPlugin(NativePushTopicsPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
