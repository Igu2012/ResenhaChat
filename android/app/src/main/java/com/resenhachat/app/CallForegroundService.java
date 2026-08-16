package com.resenhachat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

public class CallForegroundService extends Service {
  private static final String CHANNEL_ID = "resenha_active_call";
  private static final int NOTIFICATION_ID = 4103;
  private static final String ACTION_BEGIN = "com.resenhachat.app.call.BEGIN";
  private static final String ACTION_UPDATE = "com.resenhachat.app.call.UPDATE";
  private static final String ACTION_END = "com.resenhachat.app.call.END";
  private static final String ACTION_OVERLAY = "com.resenhachat.app.call.OVERLAY";
  private static final String EXTRA_TITLE = "title";
  private static final String EXTRA_PARTICIPANTS = "participants";
  private static final String EXTRA_PARTICIPANT_LABEL = "participantLabel";
  private static final String EXTRA_CAMERA = "camera";
  private static final String EXTRA_SHARING = "sharing";
  private static final String EXTRA_VISIBLE = "visible";

  private WindowManager windowManager;
  private View overlay;
  private WindowManager.LayoutParams overlayParams;
  private String title = "Chamada em andamento";
  private int participants = 1;
  private String participantLabel = "Aguardando alguém entrar";
  private boolean cameraActive;
  private boolean sharingScreen;
  private boolean overlayVisible;

  public static void begin(Context context, String title, int participants, String participantLabel, boolean cameraActive, boolean sharingScreen) {
    send(context, ACTION_BEGIN, title, participants, participantLabel, cameraActive, sharingScreen, false);
  }

  public static void update(Context context, String title, int participants, String participantLabel, boolean cameraActive, boolean sharingScreen) {
    send(context, ACTION_UPDATE, title, participants, participantLabel, cameraActive, sharingScreen, false);
  }

  public static void setOverlayVisible(Context context, boolean visible) {
    send(context, ACTION_OVERLAY, null, 0, null, false, false, visible);
  }

  public static void end(Context context) {
    Intent intent = new Intent(context, CallForegroundService.class).setAction(ACTION_END);
    context.startService(intent);
  }

  private static void send(Context context, String action, String title, int participants, String participantLabel, boolean camera, boolean sharing, boolean visible) {
    Intent intent = new Intent(context, CallForegroundService.class).setAction(action);
    if (title != null) intent.putExtra(EXTRA_TITLE, title);
    intent.putExtra(EXTRA_PARTICIPANTS, participants);
    if (participantLabel != null) intent.putExtra(EXTRA_PARTICIPANT_LABEL, participantLabel);
    intent.putExtra(EXTRA_CAMERA, camera);
    intent.putExtra(EXTRA_SHARING, sharing);
    intent.putExtra(EXTRA_VISIBLE, visible);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
    else context.startService(intent);
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent == null ? ACTION_END : intent.getAction();
    if (ACTION_END.equals(action)) {
      hideOverlay();
      stopForeground(STOP_FOREGROUND_REMOVE);
      stopSelf();
      return START_NOT_STICKY;
    }
    if (ACTION_OVERLAY.equals(action)) {
      overlayVisible = intent.getBooleanExtra(EXTRA_VISIBLE, false);
      refreshOverlay();
      return START_NOT_STICKY;
    }
    title = intent.getStringExtra(EXTRA_TITLE) == null ? title : intent.getStringExtra(EXTRA_TITLE);
    participants = Math.max(1, intent.getIntExtra(EXTRA_PARTICIPANTS, participants));
    participantLabel = intent.getStringExtra(EXTRA_PARTICIPANT_LABEL) == null ? participantLabel : intent.getStringExtra(EXTRA_PARTICIPANT_LABEL);
    cameraActive = intent.getBooleanExtra(EXTRA_CAMERA, cameraActive);
    sharingScreen = intent.getBooleanExtra(EXTRA_SHARING, sharingScreen);
    startCallForeground();
    refreshOverlay();
    return START_NOT_STICKY;
  }

  private void startCallForeground() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Chamada em andamento", NotificationManager.IMPORTANCE_LOW);
      channel.setDescription("Mantém a chamada ativa quando a Resenha está em segundo plano.");
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
      .build();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      int type = android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
      if (cameraActive) type |= android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
      if (sharingScreen) type |= android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
      startForeground(NOTIFICATION_ID, notification, type);
    } else startForeground(NOTIFICATION_ID, notification);
  }

  private boolean canDrawOverlay() {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this);
  }

  private int dp(int value) {
    return Math.round(value * getResources().getDisplayMetrics().density);
  }

  private TextView text(String value, int size, int color) {
    TextView view = new TextView(this);
    view.setText(value);
    view.setTextSize(size);
    view.setTextColor(color);
    view.setGravity(Gravity.CENTER_VERTICAL);
    return view;
  }

  private GradientDrawable shape(int color, int radius) {
    GradientDrawable drawable = new GradientDrawable();
    drawable.setColor(color);
    drawable.setCornerRadius(dp(radius));
    return drawable;
  }

  private void showOverlay() {
    if (overlay != null || !canDrawOverlay()) return;
    windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
    FrameLayout card = new FrameLayout(this);
    card.setPadding(dp(14), dp(10), dp(10), dp(10));
    card.setBackground(shape(Color.rgb(16, 33, 16), 22));
    card.setElevation(dp(14));

    LinearLayout contents = new LinearLayout(this);
    contents.setOrientation(LinearLayout.VERTICAL);
    TextView heading = text(title, 14, Color.WHITE);
    heading.setTypeface(null, 1);
    String overlayDetail = participants == 1 ? "Você está na chamada" : participants + " pessoas na chamada";
    if (!participantLabel.isEmpty()) overlayDetail += " · " + participantLabel;
    TextView detail = text(overlayDetail, 12, Color.rgb(185, 233, 122));
    contents.addView(heading);
    contents.addView(detail, new LinearLayout.LayoutParams(-2, -2));
    card.addView(contents, new FrameLayout.LayoutParams(dp(190), -2, Gravity.CENTER_VERTICAL | Gravity.START));

    TextView close = text("×", 25, Color.WHITE);
    close.setGravity(Gravity.CENTER);
    close.setBackground(shape(Color.rgb(75, 126, 36), 18));
    close.setOnClickListener(view -> { hideOverlay(); overlayVisible = false; });
    FrameLayout.LayoutParams closeLayout = new FrameLayout.LayoutParams(dp(36), dp(36), Gravity.CENTER_VERTICAL | Gravity.END);
    card.addView(close, closeLayout);
    card.setOnClickListener(view -> openApp());
    card.setOnTouchListener(new View.OnTouchListener() {
      private float initialTouchX;
      private float initialTouchY;
      private int initialX;
      private int initialY;
      private boolean dragged;
      @Override public boolean onTouch(View view, MotionEvent event) {
        if (overlayParams == null) return false;
        if (event.getAction() == MotionEvent.ACTION_DOWN) {
          initialX = overlayParams.x; initialY = overlayParams.y;
          initialTouchX = event.getRawX(); initialTouchY = event.getRawY();
          dragged = false;
          return true;
        }
        if (event.getAction() == MotionEvent.ACTION_MOVE) {
          int nextX = initialX + Math.round(event.getRawX() - initialTouchX);
          int nextY = initialY + Math.round(event.getRawY() - initialTouchY);
          dragged = Math.abs(nextX - initialX) > dp(5) || Math.abs(nextY - initialY) > dp(5);
          overlayParams.x = nextX; overlayParams.y = nextY;
          windowManager.updateViewLayout(card, overlayParams);
          return true;
        }
        if (event.getAction() == MotionEvent.ACTION_UP) {
          if (!dragged) openApp();
          return true;
        }
        return false;
      }
    });
    overlayParams = new WindowManager.LayoutParams(dp(250), dp(82), Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
    overlayParams.gravity = Gravity.TOP | Gravity.START;
    overlayParams.x = dp(18);
    overlayParams.y = dp(90);
    overlay = card;
    try { windowManager.addView(overlay, overlayParams); } catch (Exception ignored) { overlay = null; }
  }

  private void openApp() {
    Intent intent = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    startActivity(intent);
  }

  private void hideOverlay() {
    if (overlay != null && windowManager != null) {
      try { windowManager.removeView(overlay); } catch (Exception ignored) { }
    }
    overlay = null;
    overlayParams = null;
  }

  private void refreshOverlay() {
    if (overlayVisible && canDrawOverlay()) showOverlay();
    else hideOverlay();
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    // A notificação mantém a chamada acessível; o processo não é forçado a encerrar aqui.
    super.onTaskRemoved(rootIntent);
  }

  @Override
  public void onDestroy() {
    hideOverlay();
    super.onDestroy();
  }

  @Nullable @Override public IBinder onBind(Intent intent) { return null; }
}
