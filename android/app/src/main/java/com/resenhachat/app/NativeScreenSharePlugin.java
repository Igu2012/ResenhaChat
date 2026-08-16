package com.resenhachat.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.Surface;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

@CapacitorPlugin(name = "NativeScreenShare")
public class NativeScreenSharePlugin extends Plugin {
  private static final long FRAME_INTERVAL_MS = 420;
  private MediaProjection projection;
  private VirtualDisplay virtualDisplay;
  private ImageReader imageReader;
  private HandlerThread captureThread;
  private long lastFrameAt;
  private int outputWidth;
  private int outputHeight;

  @PluginMethod
  public void start(PluginCall call) {
    MediaProjectionManager manager = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
    if (manager == null) {
      call.reject("MediaProjection não está disponível neste Android.");
      return;
    }
    startActivityForResult(call, manager.createScreenCaptureIntent(), "screenShareResult");
  }

  @ActivityCallback
  private void screenShareResult(PluginCall call, ActivityResult result) {
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
      stopCapture();
      call.reject("O compartilhamento de tela foi recusado.");
      return;
    }
    try {
      ScreenProjectionService.start(getContext());
      MediaProjectionManager manager = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
      projection = manager.getMediaProjection(result.getResultCode(), result.getData());
      if (projection == null) throw new IllegalStateException("Não foi possível iniciar a projeção de tela.");
      DisplayMetrics metrics = getContext().getResources().getDisplayMetrics();
      float scale = Math.min(1f, 720f / Math.max(metrics.widthPixels, metrics.heightPixels));
      outputWidth = Math.max(2, ((int) (metrics.widthPixels * scale)) & ~1);
      outputHeight = Math.max(2, ((int) (metrics.heightPixels * scale)) & ~1);
      captureThread = new HandlerThread("resenha-screen-capture");
      captureThread.start();
      imageReader = ImageReader.newInstance(outputWidth, outputHeight, PixelFormat.RGBA_8888, 2);
      imageReader.setOnImageAvailableListener(this::onImageAvailable, new Handler(captureThread.getLooper()));
      virtualDisplay = projection.createVirtualDisplay("ResenhaScreenShare", outputWidth, outputHeight, metrics.densityDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, imageReader.getSurface(), null, null);
      projection.registerCallback(new MediaProjection.Callback() {
        @Override public void onStop() { notifyListeners("stopped", new JSObject()); stopCapture(); }
      }, new Handler(captureThread.getLooper()));
      JSObject response = new JSObject();
      response.put("width", outputWidth);
      response.put("height", outputHeight);
      call.resolve(response);
    } catch (Exception error) {
      stopCapture();
      call.reject(error.getMessage() == null ? "Não foi possível iniciar a captura de tela." : error.getMessage());
    }
  }

  private void onImageAvailable(ImageReader source) {
    Image image = source.acquireLatestImage();
    if (image == null) return;
    long now = System.currentTimeMillis();
    if (now - lastFrameAt < FRAME_INTERVAL_MS) { image.close(); return; }
    lastFrameAt = now;
    try {
      Image.Plane plane = image.getPlanes()[0];
      ByteBuffer buffer = plane.getBuffer();
      int pixelStride = plane.getPixelStride();
      int rowStride = plane.getRowStride();
      int paddedWidth = outputWidth + (rowStride - pixelStride * outputWidth) / pixelStride;
      Bitmap padded = Bitmap.createBitmap(paddedWidth, outputHeight, Bitmap.Config.ARGB_8888);
      padded.copyPixelsFromBuffer(buffer);
      Bitmap cropped = Bitmap.createBitmap(padded, 0, 0, outputWidth, outputHeight);
      ByteArrayOutputStream output = new ByteArrayOutputStream();
      cropped.compress(Bitmap.CompressFormat.JPEG, 55, output);
      cropped.recycle();
      padded.recycle();
      JSObject frame = new JSObject();
      frame.put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
      notifyListeners("frame", frame);
    } catch (Exception ignored) {
      // Um frame inválido é descartado; a projeção continua no próximo frame.
    } finally {
      image.close();
    }
  }

  @PluginMethod
  public void stop(PluginCall call) {
    stopCapture();
    call.resolve();
  }

  @Override
  protected void handleOnDestroy() { stopCapture(); }

  private void stopCapture() {
    if (virtualDisplay != null) { virtualDisplay.release(); virtualDisplay = null; }
    if (imageReader != null) { imageReader.close(); imageReader = null; }
    if (projection != null) { projection.stop(); projection = null; }
    if (captureThread != null) { captureThread.quitSafely(); captureThread = null; }
    getContext().stopService(new Intent(getContext(), ScreenProjectionService.class));
  }
}
