import type { LocalAttachment } from "./localOrbit";

export type AttachmentRetentionClass = "media" | "temporary" | "none";

/**
 * Metadado público mínimo: não revela o conteúdo, nome, tamanho ou MIME
 * completo do anexo. Ele apenas permite ao servidor decidir a expiração.
 */
export function attachmentRetentionClass(attachment: LocalAttachment | null | undefined): AttachmentRetentionClass {
  if (!attachment) return "none";
  return /^(audio|image|video)\//i.test(attachment.mimeType) ? "media" : "temporary";
}
