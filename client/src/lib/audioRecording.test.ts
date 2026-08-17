import { describe, expect, it } from "vitest";
import { AUDIO_MIN_SEND_HOLD_MS, AUDIO_PRE_RECORD_DELAY_MS, shouldSendHeldAudio } from "./audioRecording";

describe("gravação de áudio por pressão", () => {
  it("inicia a pré-gravação após um segundo e só envia ao soltar após dois segundos", () => {
    expect(AUDIO_PRE_RECORD_DELAY_MS).toBe(1_000);
    expect(shouldSendHeldAudio(0, AUDIO_MIN_SEND_HOLD_MS - 1)).toBe(false);
    expect(shouldSendHeldAudio(0, AUDIO_MIN_SEND_HOLD_MS)).toBe(true);
  });

  it("nunca envia quando o gesto é cancelado", () => {
    expect(shouldSendHeldAudio(0, AUDIO_MIN_SEND_HOLD_MS + 500, true)).toBe(false);
  });
});
