import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { PushNotifications } from "@capacitor/push-notifications";
import type { Socket } from "socket.io-client";

export const APP_VERSION = "1.0.0";
const RELEASES_ENDPOINT = "https://api.github.com/repos/Igu2012/ResenhaChat/releases/latest";
const RESENHA_API_ORIGIN = (import.meta.env.VITE_RESENHA_SERVER_URL || "https://resenhudochat.onrender.com").replace(/\/+$/, "");

type NativeScreenSharePlugin = {
  start: () => Promise<{ width: number; height: number }>;
  stop: () => Promise<void>;
  addListener: (eventName: "frame" | "stopped", listener: (payload: { dataUrl?: string }) => void) => Promise<PluginListenerHandle>;
};

const NativeScreenShare = registerPlugin<NativeScreenSharePlugin>("NativeScreenShare");

type NativeCallOverlayPlugin = {
  begin: (options: NativeCallSession) => Promise<{ overlayAllowed: boolean }>;
  update: (options: NativeCallSession) => Promise<{ overlayAllowed: boolean }>;
  end: () => Promise<void>;
  setOverlayVisible: (options: { visible: boolean }) => Promise<{ overlayAllowed: boolean }>;
  requestOverlayPermission: () => Promise<{ overlayAllowed: boolean }>;
};

const NativeCallOverlay = registerPlugin<NativeCallOverlayPlugin>("NativeCallOverlay");

export type NativeCallSession = { title: string; participants: number; participantLabel: string; cameraActive: boolean; sharingScreen: boolean };

export type NativeScreenCapture = { stream: MediaStream; stop: () => Promise<void> };

export function isNativeRuntime() {
  return Capacitor.isNativePlatform();
}

export async function startNativeScreenCapture(): Promise<NativeScreenCapture> {
  if (!isNativeRuntime()) throw new Error("A captura MediaProjection é exclusiva da APK Android.");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context || !("captureStream" in canvas)) throw new Error("Este WebView não consegue receber a captura nativa.");
  let stream: MediaStream | null = null;
  const frameListener = await NativeScreenShare.addListener("frame", ({ dataUrl }) => {
    if (!dataUrl) return;
    const image = new Image();
    image.onload = () => {
      if (canvas.width !== image.width || canvas.height !== image.height) { canvas.width = image.width; canvas.height = image.height; }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = dataUrl;
  });
  const stoppedListener = await NativeScreenShare.addListener("stopped", () => stream?.getTracks().forEach(track => track.stop()));
  try {
    const size = await NativeScreenShare.start();
    canvas.width = size.width;
    canvas.height = size.height;
    stream = (canvas as HTMLCanvasElement & { captureStream: (frameRate?: number) => MediaStream }).captureStream(3);
  } catch (error) {
    await frameListener.remove();
    await stoppedListener.remove();
    throw error;
  }
  return {
    stream: stream as MediaStream,
    stop: async () => {
      stream?.getTracks().forEach(track => track.stop());
      await Promise.all([frameListener.remove(), stoppedListener.remove()]);
      await NativeScreenShare.stop();
    },
  };
}

type GitHubRelease = {
  tag_name?: string;
  html_url?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
};

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, "").split("-")[0].split(".").map(part => Number.parseInt(part, 10) || 0);
}

export function isNewerVersion(candidate: string, current = APP_VERSION) {
  const latest = normalizeVersion(candidate);
  const installed = normalizeVersion(current);
  const length = Math.max(latest.length, installed.length);
  for (let index = 0; index < length; index += 1) {
    if ((latest[index] || 0) !== (installed[index] || 0)) return (latest[index] || 0) > (installed[index] || 0);
  }
  return false;
}

export async function getLatestReleaseDownload() {
  try {
    const response = await fetch(RELEASES_ENDPOINT, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return null;
    const release = await response.json() as GitHubRelease;
    const apk = release.assets?.find(asset => asset.name?.toLowerCase().endsWith(".apk"))?.browser_download_url;
    return { version: release.tag_name || null, url: apk || release.html_url || null };
  } catch {
    return null;
  }
}

export async function checkForUpdate() {
  if (!isNativeRuntime() || !navigator.onLine) return null;
  const release = await getLatestReleaseDownload();
  if (!release?.version || !isNewerVersion(release.version)) return null;
  return release;
}

export async function openUpdateDownload(url: string) {
  if (!isNativeRuntime()) return;
  await Browser.open({ url });
}

export function getRuntimeServerOrigin() {
  return RESENHA_API_ORIGIN;
}

export function runtimeApiUrl(path: string) {
  const origin = getRuntimeServerOrigin();
  return origin ? `${origin}${path}` : path;
}

export async function beginNativeCallSession(session: NativeCallSession) {
  if (!isNativeRuntime()) return { overlayAllowed: false };
  return NativeCallOverlay.begin(session);
}

export async function updateNativeCallSession(session: NativeCallSession) {
  if (!isNativeRuntime()) return { overlayAllowed: false };
  return NativeCallOverlay.update(session);
}

export async function endNativeCallSession() {
  if (!isNativeRuntime()) return;
  await NativeCallOverlay.end();
}

export async function setNativeCallOverlayVisible(visible: boolean) {
  if (!isNativeRuntime()) return { overlayAllowed: false };
  return NativeCallOverlay.setOverlayVisible({ visible });
}

export async function requestNativeCallOverlayPermission() {
  if (!isNativeRuntime()) return { overlayAllowed: false };
  return NativeCallOverlay.requestOverlayPermission();
}

export async function requestNativeNotificationPermission() {
  if (!isNativeRuntime()) return false;
  try {
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === "prompt") permission = await PushNotifications.requestPermissions();
    return permission.receive === "granted";
  } catch {
    return false;
  }
}

export async function registerNativePush(socket: Socket) {
  if (!isNativeRuntime()) return () => undefined;
  const listeners: PluginListenerHandle[] = [];
  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") return () => undefined;
  await PushNotifications.register();
  listeners.push(await PushNotifications.addListener("registration", token => socket.emit("push:register", { token: token.value })));
  return () => { listeners.forEach(listener => void listener.remove()); };
}
