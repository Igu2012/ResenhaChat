import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION, beginNativeCallSession, getLatestReleaseDownload, isNewerVersion, markUpdateDownloadOffered, requestNativeMediaPermission, requestNativeNotificationPermission, setNativeCallOverlayVisible, shouldOpenUpdateDownload, toReleaseDownload } from "./nativeRuntime";

afterEach(() => vi.unstubAllGlobals());
const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});

describe("isNewerVersion", () => {
  it("usa a versão centralizada do pacote de release", () => {
    expect(APP_VERSION).toBe("1.0.7");
  });

  it("identifica uma release semântica mais recente", () => {
    expect(isNewerVersion("v1.0.1", "1.0.0")).toBe(true);
    expect(isNewerVersion("1.2.0", "1.1.99")).toBe(true);
  });

  it("ignora versões iguais, inferiores e sufixos de release", () => {
    expect(isNewerVersion("v1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("0.9.9", "1.0.0")).toBe(false);
    expect(isNewerVersion("v1.1.0-beta", "1.0.0")).toBe(true);
  });

  it("prefere a APK da última release para o prompt de instalação mobile", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v1.2.0", html_url: "https://github.com/Igu2012/ResenhaChat/releases/tag/v1.2.0", assets: [{ name: "ResenhaChat.apk", browser_download_url: "https://downloads.example/ResenhaChat.apk" }] }),
    }));

    await expect(getLatestReleaseDownload()).resolves.toEqual({ version: "v1.2.0", url: "https://downloads.example/ResenhaChat.apk" });
  });

  it("prioriza a APK estável mesmo quando a release possui outros arquivos APK", () => {
    expect(toReleaseDownload({
      tag_name: "v1.2.0",
      html_url: "https://github.com/Igu2012/ResenhaChat/releases/tag/v1.2.0",
      assets: [
        { name: "arquivo-de-teste.apk", browser_download_url: "https://downloads.example/test.apk" },
        { name: "ResenhaChat.apk", browser_download_url: "https://downloads.example/ResenhaChat.apk" },
      ],
    })).toEqual({ version: "v1.2.0", url: "https://downloads.example/ResenhaChat.apk" });
  });

  it("abre o download automático somente uma vez por versão", () => {
    expect(shouldOpenUpdateDownload("v1.2.0")).toBe(true);
    markUpdateDownloadOffered("v1.2.0");
    expect(shouldOpenUpdateDownload("v1.2.0")).toBe(false);
    expect(shouldOpenUpdateDownload("v1.2.1")).toBe(true);
  });
});

describe("ponte de chamada nativa", () => {
  it("não tenta acessar o serviço Android na versão web", async () => {
    const session = { title: "Chamada em andamento", participants: 2, participantLabel: "Ana", cameraActive: true, sharingScreen: false };
    await expect(beginNativeCallSession(session)).resolves.toEqual({ overlayAllowed: false });
    await expect(setNativeCallOverlayVisible(true)).resolves.toEqual({ overlayAllowed: false });
    await expect(requestNativeNotificationPermission()).resolves.toBe(false);
    await expect(requestNativeMediaPermission({ camera: true, microphone: true })).resolves.toEqual({ camera: true, microphone: true });
  });
});
