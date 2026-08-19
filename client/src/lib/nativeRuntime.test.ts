import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION, addNativeBackButtonListener, addNativeResumeListener, beginNativeCallSession, exitNativeApp, getLatestPlatformReleaseDownloads, getLatestReleaseDownload, isNewerVersion, markUpdateDownloadOffered, requestNativeMediaPermission, requestNativeNotificationPermission, shouldOpenUpdateDownload, toPlatformReleaseDownloads, toReleaseDownload } from "./nativeRuntime";

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
    expect(APP_VERSION).toBe("1.0.44");
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

  it("separa a APK da IPA quando a mesma release fornece os dois instaladores", async () => {
    const release = {
      tag_name: "v1.0.12",
      assets: [
        { name: "ResenhaChat.apk", browser_download_url: "https://downloads.example/ResenhaChat.apk" },
        { name: "ResenhaChat.ipa", browser_download_url: "https://downloads.example/ResenhaChat.ipa" },
      ],
    };
    expect(toPlatformReleaseDownloads(release)).toEqual({
      android: { version: "v1.0.12", url: "https://downloads.example/ResenhaChat.apk" },
      ios: { version: "v1.0.12", url: "https://downloads.example/ResenhaChat.ipa" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => release }));
    await expect(getLatestPlatformReleaseDownloads()).resolves.toEqual({
      android: { version: "v1.0.12", url: "https://downloads.example/ResenhaChat.apk" },
      ios: { version: "v1.0.12", url: "https://downloads.example/ResenhaChat.ipa" },
    });
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
    await expect(beginNativeCallSession(session)).resolves.toBeUndefined();
    await expect(requestNativeNotificationPermission()).resolves.toBe(false);
    await expect(requestNativeMediaPermission({ camera: true, microphone: true })).resolves.toEqual({ camera: true, microphone: true });
  });

  it("não registra retorno físico nem encerra o navegador fora do runtime nativo", async () => {
    const remove = await addNativeBackButtonListener(() => undefined);
    expect(remove()).toBeUndefined();
    await expect(exitNativeApp()).resolves.toBeUndefined();
  });

  it("não registra a retomada nativa fora da APK", async () => {
    const remove = await addNativeResumeListener(() => undefined);
    expect(remove()).toBeUndefined();
  });
});
