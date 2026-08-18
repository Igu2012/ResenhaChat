export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
// Base64 e o envelope E2EE codificam anexos duas vezes, uma vez por destinatário.
// A margem mantém anexos de até 15 MB viáveis também em conversas de servidor.
export const MAX_ATTACHMENT_WIRE_BYTES = 96 * 1024 * 1024;

export function acceptsAttachmentSize(size: number) {
  return Number.isFinite(size) && size >= 0 && size <= MAX_ATTACHMENT_BYTES;
}
