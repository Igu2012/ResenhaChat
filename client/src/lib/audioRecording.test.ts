import { describe, expect, it } from "vitest";
import { AUDIO_MIN_SEND_HOLD_MS, shouldSendHeldAudio } from "./audioRecording";

describe("gravação de áudio por pressão", () => {
  it("envia ao soltar após um segundo de gravação", () => {
    expect(shouldSendHeldAudio(0, AUDIO_MIN_SEND_HOLD_MS - 1)).toBe(false);
    expect(shouldSendHeldAudio(0, AUDIO_MIN_SEND_HOLD_MS)).toBe(true);
  });

  it("nunca envia quando o gesto é cancelado", () => {
    expect(shouldSendHeldAudio(0, AUDIO_MIN_SEND_HOLD_MS + 500, true)).toBe(false);
  });
});
