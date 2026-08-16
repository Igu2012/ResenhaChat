import { afterEach, describe, expect, it, vi } from "vitest";
import { beginNativeCallSession, getLatestReleaseDownload, isNewerVersion, requestNativeNotificationPermission, setNativeCallOverlayVisible } from "./nativeRuntime";

afterEach(() => vi.unstubAllGlobals());

describe("isNewerVersion", () => {
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
});

describe("ponte de chamada nativa", () => {
  it("não tenta acessar o serviço Android na versão web", async () => {
    const session = { title: "Chamada em andamento", participants: 2, participantLabel: "Ana", cameraActive: true, sharingScreen: false };
    await expect(beginNativeCallSession(session)).resolves.toEqual({ overlayAllowed: false });
    await expect(setNativeCallOverlayVisible(true)).resolves.toEqual({ overlayAllowed: false });
    await expect(requestNativeNotificationPermission()).resolves.toBe(false);
  });
});
