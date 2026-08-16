import { describe, expect, it } from "vitest";
import { acceptsAttachmentSize, MAX_ATTACHMENT_BYTES } from "../../../shared/attachmentLimits";

function validateClientAttachment(size: number) {
  if (!acceptsAttachmentSize(size)) throw new Error("O arquivo ultrapassa o limite de 15 MB.");
  return { accepted: true, size };
}

describe("validação de anexo no cliente", () => {
  it("aceita um arquivo de exatamente 15 MB antes de iniciar a leitura local", () => {
    expect(validateClientAttachment(MAX_ATTACHMENT_BYTES)).toEqual({ accepted: true, size: MAX_ATTACHMENT_BYTES });
  });

  it("recusa de modo controlado um arquivo acima de 15 MB", () => {
    expect(() => validateClientAttachment(MAX_ATTACHMENT_BYTES + 1)).toThrow("ultrapassa o limite de 15 MB");
  });
});
