import { afterEach, describe, expect, it, vi } from "vitest";
import { activateExclusiveMedia, clearExclusiveMedia, resetExclusiveMediaPlayback } from "./exclusiveMediaPlayback";

describe("reprodução exclusiva de mídia", () => {
  afterEach(() => resetExclusiveMediaPlayback());

  it("pausa a mídia anterior ao iniciar outra", () => {
    const first = { pause: vi.fn() };
    const second = { pause: vi.fn() };

    activateExclusiveMedia(first);
    activateExclusiveMedia(second);

    expect(first.pause).toHaveBeenCalledOnce();
    expect(second.pause).not.toHaveBeenCalled();
  });

  it("não pausa novamente uma mídia que já foi encerrada", () => {
    const first = { pause: vi.fn() };
    const second = { pause: vi.fn() };

    activateExclusiveMedia(first);
    clearExclusiveMedia(first);
    activateExclusiveMedia(second);

    expect(first.pause).not.toHaveBeenCalled();
  });
});
