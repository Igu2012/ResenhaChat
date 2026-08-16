package com.resenhachat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

public class ScreenProjectionService extends Service {
  private static final String CHANNEL_ID = "resenha_screen_share";
  private static final int NOTIFICATION_ID = 4102;

  public static void start(Context context) {
    Intent intent = new Intent(context, ScreenProjectionService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
    else context.startService(intent);
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Compartilhamento de tela", NotificationManager.IMPORTANCE_LOW);
      channel.setDescription("Mantém ativa a captura de tela durante a chamada.");
      ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);
    }
    Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
      ? new Notification.Builder(this, CHANNEL_ID)
      : new Notification.Builder(this);
    Notification notification = builder
      .setContentTitle("Resenha Chat está compartilhando a tela")
      .setContentText("Toque em encerrar na chamada para interromper.")
      .setSmallIcon(R.drawable.ic_launcher_foreground)
      .setOngoing(true)
      .build();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
    else startForeground(NOTIFICATION_ID, notification);
    return START_NOT_STICKY;
  }

  @Override public IBinder onBind(Intent intent) { return null; }
}
