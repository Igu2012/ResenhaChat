package com.resenhachat.app;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Ponte nativa de chamadas. O nome é mantido para compatibilidade com a ponte Capacitor existente. */
@CapacitorPlugin(name = "NativeCallOverlay")
public class NativeCallOverlayPlugin extends Plugin {
  private void setCallVolumeMode(boolean active) {
    AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    if (audio == null) return;
    audio.setMode(active ? AudioManager.MODE_IN_COMMUNICATION : AudioManager.MODE_NORMAL);
    if (getActivity() != null) getActivity().setVolumeControlStream(active ? AudioManager.STREAM_VOICE_CALL : AudioManager.USE_DEFAULT_STREAM_TYPE);
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
    call.resolve();
  }

  @PluginMethod public void begin(PluginCall call) { sendCallState(call, true); }
  @PluginMethod public void update(PluginCall call) { sendCallState(call, false); }

  @PluginMethod public void end(PluginCall call) {
    CallForegroundService.end(getContext());
    setCallVolumeMode(false);
    call.resolve();
  }
}
