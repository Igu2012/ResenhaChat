package com.resenhachat.app;

import android.content.Intent;
import android.content.Context;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeCallOverlay")
public class NativeCallOverlayPlugin extends Plugin {
  private void setCallVolumeMode(boolean active) {
    AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    if (audio == null) return;
    audio.setMode(active ? AudioManager.MODE_IN_COMMUNICATION : AudioManager.MODE_NORMAL);
    if (getActivity() != null) getActivity().setVolumeControlStream(active ? AudioManager.STREAM_VOICE_CALL : AudioManager.USE_DEFAULT_STREAM_TYPE);
  }

  private boolean overlayAllowed() {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext());
  }

  private void sendCallState(PluginCall call, boolean begin) {
    String title = call.getString("title", "Chamada em andamento");
    int participants = call.getInt("participants", 1);
    String participantLabel = call.getString("participantLabel", "Aguardando alguém entrar");
    boolean cameraActive = call.getBoolean("cameraActive", false);
    boolean sharingScreen = call.getBoolean("sharingScreen", false);
    setCallVolumeMode(true);
    if (begin) CallForegroundService.begin(getContext(), title, participants, participantLabel, cameraActive, sharingScreen);
    else CallForegroundService.update(getContext(), title, participants, participantLabel, cameraActive, sharingScreen);
    JSObject result = new JSObject();
    result.put("overlayAllowed", overlayAllowed());
    call.resolve(result);
  }

  @PluginMethod
  public void begin(PluginCall call) { sendCallState(call, true); }

  @PluginMethod
  public void update(PluginCall call) { sendCallState(call, false); }

  @PluginMethod
  public void end(PluginCall call) {
    CallForegroundService.end(getContext());
    setCallVolumeMode(false);
    call.resolve();
  }

  @PluginMethod
  public void setOverlayVisible(PluginCall call) {
    CallForegroundService.setOverlayVisible(getContext(), call.getBoolean("visible", false) && overlayAllowed());
    JSObject result = new JSObject();
    result.put("overlayAllowed", overlayAllowed());
    call.resolve(result);
  }

  @PluginMethod
  public void requestOverlayPermission(PluginCall call) {
    if (overlayAllowed()) {
      JSObject result = new JSObject();
      result.put("overlayAllowed", true);
      call.resolve(result);
      return;
    }
    Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
    startActivityForResult(call, intent, "overlayPermissionResult");
  }

  @ActivityCallback
  private void overlayPermissionResult(PluginCall call, ActivityResult result) {
    JSObject response = new JSObject();
    response.put("overlayAllowed", overlayAllowed());
    call.resolve(response);
  }
}
