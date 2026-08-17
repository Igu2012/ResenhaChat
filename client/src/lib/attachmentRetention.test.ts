import { describe, expect, it } from "vitest";
import { attachmentRetentionClass } from "./attachmentRetention";

describe("attachmentRetentionClass", () => {
  it("preserva áudio, imagem e vídeo como mídia", () => {
    expect(attachmentRetentionClass({ name: "voz.webm", mimeType: "audio/webm", size: 10, dataUrl: "data:" })).toBe("media");
    expect(attachmentRetentionClass({ name: "foto.png", mimeType: "image/png", size: 10, dataUrl: "data:" })).toBe("media");
    expect(attachmentRetentionClass({ name: "video.mp4", mimeType: "video/mp4", size: 10, dataUrl: "data:" })).toBe("media");
  });

  it("marca arquivos comuns para expiração e mensagens sem arquivo como none", () => {
    expect(attachmentRetentionClass({ name: "arquivo.zip", mimeType: "application/zip", size: 10, dataUrl: "data:" })).toBe("temporary");
    expect(attachmentRetentionClass(undefined)).toBe("none");
  });
});
