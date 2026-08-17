package com.resenhachat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;

/** Mantém a chamada em primeiro plano com notificação; não usa janelas sobre outros apps. */
public class CallForegroundService extends Service {
  private static final String CHANNEL_ID = "resenha_active_call_v3";
  private static final int NOTIFICATION_ID = 4103;
  private static final String ACTION_BEGIN = "com.resenhachat.app.call.BEGIN";
  private static final String ACTION_UPDATE = "com.resenhachat.app.call.UPDATE";
  private static final String ACTION_END = "com.resenhachat.app.call.END";
  private static final String EXTRA_TITLE = "title";
  private static final String EXTRA_PARTICIPANTS = "participants";
  private static final String EXTRA_PARTICIPANT_LABEL = "participantLabel";
  private static final String EXTRA_CAMERA = "camera";
  private static final String EXTRA_SHARING = "sharing";

  private String title = "Chamada em andamento";
  private int participants = 1;
  private String participantLabel = "Aguardando alguém entrar";
  private boolean cameraActive;
  private boolean sharingScreen;

  public static void begin(Context context, String title, int participants, String participantLabel, boolean cameraActive, boolean sharingScreen) {
    send(context, ACTION_BEGIN, title, participants, participantLabel, cameraActive, sharingScreen);
  }

  public static void update(Context context, String title, int participants, String participantLabel, boolean cameraActive, boolean sharingScreen) {
    send(context, ACTION_UPDATE, title, participants, participantLabel, cameraActive, sharingScreen);
  }

  public static void end(Context context) {
    context.startService(new Intent(context, CallForegroundService.class).setAction(ACTION_END));
  }

  private static void send(Context context, String action, String title, int participants, String participantLabel, boolean camera, boolean sharing) {
    Intent intent = new Intent(context, CallForegroundService.class).setAction(action);
    intent.putExtra(EXTRA_TITLE, title);
    intent.putExtra(EXTRA_PARTICIPANTS, participants);
    intent.putExtra(EXTRA_PARTICIPANT_LABEL, participantLabel);
    intent.putExtra(EXTRA_CAMERA, camera);
    intent.putExtra(EXTRA_SHARING, sharing);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
    else context.startService(intent);
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent == null ? ACTION_UPDATE : intent.getAction();
    if (ACTION_END.equals(action)) {
      stopForeground(STOP_FOREGROUND_REMOVE);
      stopSelf();
      return START_NOT_STICKY;
    }
    if (intent != null) {
      title = intent.getStringExtra(EXTRA_TITLE) == null ? title : intent.getStringExtra(EXTRA_TITLE);
      participants = Math.max(1, intent.getIntExtra(EXTRA_PARTICIPANTS, participants));
      participantLabel = intent.getStringExtra(EXTRA_PARTICIPANT_LABEL) == null ? participantLabel : intent.getStringExtra(EXTRA_PARTICIPANT_LABEL);
      cameraActive = intent.getBooleanExtra(EXTRA_CAMERA, cameraActive);
      sharingScreen = intent.getBooleanExtra(EXTRA_SHARING, sharingScreen);
    }
    startCallForeground();
    return START_STICKY;
  }

  private void startCallForeground() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Chamada em andamento", NotificationManager.IMPORTANCE_LOW);
      channel.setDescription("Mantém a chamada ativa quando a Resenha Chat está em segundo plano.");
      ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);
    }
    Intent openApp = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent openPending = PendingIntent.getActivity(this, 0, openApp, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    String detail = participants == 1 ? "Você está na chamada" : participants + " pessoas na chamada";
    if (!participantLabel.isEmpty()) detail += " · " + participantLabel;
    if (sharingScreen) detail += " · tela compartilhada";
    Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(this, CHANNEL_ID) : new Notification.Builder(this);
    Notification notification = builder
      .setSmallIcon(R.drawable.ic_launcher_foreground)
      .setContentTitle(title)
      .setContentText(detail)
      .setContentIntent(openPending)
      .setCategory(Notification.CATEGORY_CALL)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(Notification.PRIORITY_LOW)
      .build();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      int type = android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
      if (cameraActive) type |= android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
      startForeground(NOTIFICATION_ID, notification, type);
    } else startForeground(NOTIFICATION_ID, notification);
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    // Não encerra a chamada ao remover a tela do app das recentes.
    super.onTaskRemoved(rootIntent);
  }

  @Nullable @Override public IBinder onBind(Intent intent) { return null; }
}
