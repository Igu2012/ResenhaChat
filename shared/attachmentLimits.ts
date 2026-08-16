export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
// Base64 acrescenta aproximadamente 33%; a margem adicional cobre o envelope Socket.io.
export const MAX_ATTACHMENT_WIRE_BYTES = 24 * 1024 * 1024;

export function acceptsAttachmentSize(size: number) {
  return Number.isFinite(size) && size >= 0 && size <= MAX_ATTACHMENT_BYTES;
}
