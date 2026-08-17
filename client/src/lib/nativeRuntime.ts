import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { PushNotifications } from "@capacitor/push-notifications";
import type { Socket } from "socket.io-client";

declare const __RESENHA_APP_VERSION__: string;

export const APP_VERSION = __RESENHA_APP_VERSION__;
const RELEASES_ENDPOINT = "https://api.github.com/repos/Igu2012/ResenhaChat/releases/latest";
const RESENHA_API_ORIGIN = (import.meta.env.VITE_RESENHA_SERVER_URL || "https://resenhudochat.onrender.com").replace(/\/+$/, "");
const LAST_OFFERED_UPDATE_KEY = "resenha-chat:last-offered-update";
const PUSH_TOKEN_KEY = "resenha-chat:native-push-token";

type NativeScreenSharePlugin = {
  start: () => Promise<{ width: number; height: number }>;
  stop: () => Promise<void>;
  addListener: (eventName: "frame" | "stopped", listener: (payload: { dataUrl?: string }) => void) => Promise<PluginListenerHandle>;
};

const NativeScreenShare = registerPlugin<NativeScreenSharePlugin>("NativeScreenShare");

type NativeCallOverlayPlugin = {
  begin: (options: NativeCallSession) => Promise<void>;
  update: (options: NativeCallSession) => Promise<void>;
  end: () => Promise<void>;
};

const NativeCallOverlay = registerPlugin<NativeCallOverlayPlugin>("NativeCallOverlay");

type NativeMediaPermissionPlugin = {
  request: (options: { camera?: boolean; microphone?: boolean }) => Promise<{ camera?: "granted" | "denied"; microphone?: "granted" | "denied" }>;
};

const NativeMediaPermission = registerPlugin<NativeMediaPermissionPlugin>("NativeMediaPermission");

type NativePushTopicsPlugin = {
  subscribe: (options: { topic: string }) => Promise<{ subscribed: boolean }>;
};

const NativePushTopics = registerPlugin<NativePushTopicsPlugin>("NativePushTopics");

export type NativeCallSession = { title: string; participants: number; participantLabel: string; cameraActive: boolean; sharingScreen: boolean };

export type NativeScreenCapture = { stream: MediaStream; stop: () => Promise<void> };

export function isNativeRuntime() {
  return Capacitor.isNativePlatform();
}

export async function addNativeBackButtonListener(onBack: () => void) {
  if (!isNativeRuntime()) return () => undefined;
  const listener = await App.addListener("backButton", onBack);
  return () => { void listener.remove(); };
}

export async function addNativeResumeListener(onResume: () => void) {
  if (!isNativeRuntime()) return () => undefined;
  const listener = await App.addListener("appStateChange", ({ isActive }) => { if (isActive) onResume(); });
  return () => { void listener.remove(); };
}

export async function exitNativeApp() {
  if (!isNativeRuntime()) return;
  await App.exitApp();
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

export type ReleaseDownload = { version: string | null; url: string | null };
export type PlatformReleaseDownloads = { android: ReleaseDownload; ios: ReleaseDownload };

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

export function toPlatformReleaseDownloads(release: GitHubRelease): PlatformReleaseDownloads {
  const apk = release.assets?.find(asset => asset.name?.toLowerCase() === "resenhachat.apk")
    ?? release.assets?.find(asset => asset.name?.toLowerCase().endsWith(".apk"));
  const ipa = release.assets?.find(asset => asset.name?.toLowerCase() === "resenhachat.ipa")
    ?? release.assets?.find(asset => asset.name?.toLowerCase().endsWith(".ipa"));
  return {
    android: { version: release.tag_name || null, url: apk?.browser_download_url || release.html_url || null },
    ios: { version: release.tag_name || null, url: ipa?.browser_download_url || null },
  };
}

export function toReleaseDownload(release: GitHubRelease): ReleaseDownload {
  return toPlatformReleaseDownloads(release).android;
}

export async function getLatestReleaseDownload() {
  const downloads = await getLatestPlatformReleaseDownloads();
  return downloads?.android || null;
}

export async function getLatestPlatformReleaseDownloads() {
  try {
    const response = await fetch(RELEASES_ENDPOINT, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return null;
    const release = await response.json() as GitHubRelease;
    return toPlatformReleaseDownloads(release);
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

export function shouldOpenUpdateDownload(version: string) {
  try {
    return localStorage.getItem(LAST_OFFERED_UPDATE_KEY) !== version;
  } catch {
    return true;
  }
}

export function markUpdateDownloadOffered(version: string) {
  try {
    localStorage.setItem(LAST_OFFERED_UPDATE_KEY, version);
  } catch {
    // Sem armazenamento disponível, o fluxo segue normalmente.
  }
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
  if (!isNativeRuntime()) return;
  return NativeCallOverlay.begin(session);
}

export async function updateNativeCallSession(session: NativeCallSession) {
  if (!isNativeRuntime()) return;
  return NativeCallOverlay.update(session);
}

export async function endNativeCallSession() {
  if (!isNativeRuntime()) return;
  await NativeCallOverlay.end();
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

export async function requestNativeMediaPermission(options: { camera: boolean; microphone: boolean }) {
  if (!isNativeRuntime()) return { camera: true, microphone: true };
  try {
    const result = await NativeMediaPermission.request(options);
    return {
      camera: !options.camera || result.camera === "granted",
      microphone: !options.microphone || result.microphone === "granted",
    };
  } catch {
    return { camera: false, microphone: false };
  }
}

export async function registerNativePush(socket: Socket) {
  if (!isNativeRuntime()) return () => undefined;
  const listeners: PluginListenerHandle[] = [];
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive === "prompt") permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") return () => undefined;
  const sendToken = (token: string | null) => {
    if (token && socket.connected) socket.emit("push:register", { token });
  };
  const cachedToken = (() => {
    try { return localStorage.getItem(PUSH_TOKEN_KEY); } catch { return null; }
  })();
  const onConnect = () => sendToken(cachedToken);
  socket.on("connect", onConnect);
  listeners.push(await PushNotifications.addListener("registration", token => {
    try { localStorage.setItem(PUSH_TOKEN_KEY, token.value); } catch { /* armazenamento opcional */ }
    sendToken(token.value);
  }));
  listeners.push(await PushNotifications.addListener("registrationError", () => undefined));
  await PushNotifications.register();
  sendToken(cachedToken);
  return () => {
    socket.off("connect", onConnect);
    listeners.forEach(listener => void listener.remove());
  };
}

function nativePushTopic(profileId: string) {
  return `resenha_${profileId.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 900);
}

export async function subscribeNativePushProfile(profileId: string) {
  if (!isNativeRuntime() || !profileId) return false;
  try {
    const result = await NativePushTopics.subscribe({ topic: nativePushTopic(profileId) });
    return result.subscribed;
  } catch {
    return false;
  }
}
