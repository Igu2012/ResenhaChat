export const AUDIO_PRE_RECORD_DELAY_MS = 1_000;
export const AUDIO_MIN_SEND_HOLD_MS = 1_000;

export function shouldSendHeldAudio(pressedAt: number, releasedAt: number, cancelled = false) {
  return !cancelled && releasedAt - pressedAt >= AUDIO_MIN_SEND_HOLD_MS;
}
