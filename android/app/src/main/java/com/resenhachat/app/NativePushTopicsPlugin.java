package com.resenhachat.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

@CapacitorPlugin(name = "NativePushTopics")
public class NativePushTopicsPlugin extends Plugin {
  @PluginMethod
  public void subscribe(PluginCall call) {
    String topic = call.getString("topic", "");
    if (!topic.matches("[A-Za-z0-9_-]{1,900}")) {
      call.reject("Tópico de notificação inválido.");
      return;
    }
    FirebaseMessaging.getInstance().subscribeToTopic(topic).addOnCompleteListener(task -> {
      if (!task.isSuccessful()) {
        call.reject("Não foi possível registrar as notificações.");
        return;
      }
      JSObject result = new JSObject();
      result.put("subscribed", true);
      call.resolve(result);
    });
  }
}
