package com.resenhachat.app;

import android.Manifest;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
  name = "NativeMediaPermission",
  permissions = {
    @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
  }
)
public class NativeMediaPermissionPlugin extends Plugin {
  @PluginMethod
  public void request(PluginCall call) {
    boolean wantsCamera = call.getBoolean("camera", false);
    boolean wantsMicrophone = call.getBoolean("microphone", false);

    if (wantsCamera && wantsMicrophone) {
      requestAllPermissions(call, "permissionResult");
    } else if (wantsCamera) {
      requestPermissionForAlias("camera", call, "permissionResult");
    } else if (wantsMicrophone) {
      requestPermissionForAlias("microphone", call, "permissionResult");
    } else {
      permissionResult(call);
    }
  }

  @PermissionCallback
  private void permissionResult(PluginCall call) {
    JSObject result = new JSObject();
    result.put("camera", getPermissionState("camera") == PermissionState.GRANTED ? "granted" : "denied");
    result.put("microphone", getPermissionState("microphone") == PermissionState.GRANTED ? "granted" : "denied");
    call.resolve(result);
  }
}
