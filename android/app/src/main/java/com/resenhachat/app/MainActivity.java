package com.resenhachat.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(android.os.Bundle savedInstanceState) {
    registerPlugin(NativeScreenSharePlugin.class);
    registerPlugin(NativeCallOverlayPlugin.class);
    registerPlugin(NativeMediaPermissionPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
