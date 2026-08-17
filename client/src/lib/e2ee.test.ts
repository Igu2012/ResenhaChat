import { beforeEach, describe, expect, it } from "vitest";
import { decryptMessageForRecipient, encryptMessageForRecipients, ensureEncryptionPublicKey } from "./e2ee";

function createLocalStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  };
}

describe("criptografia ponta a ponta", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: createLocalStorage() });
  });

  it("protege texto, anexo e referência de resposta em trânsito", async () => {
    const aliceKey = await ensureEncryptionPublicKey("alice");
    const bobKey = await ensureEncryptionPublicKey("bob");
    const encrypted = await encryptMessageForRecipients("alice", [{ id: "bob", encryptionPublicKey: bobKey }], {
      body: "mensagem privada",
      attachment: { name: "nota.txt", mimeType: "text/plain", size: 12, dataUrl: "data:text/plain;base64,c2VncmVkbw==" },
      replyTo: { id: "mensagem-anterior", authorName: "Bia", preview: "Mensagem anterior" },
    });

    expect(JSON.stringify(encrypted)).not.toContain("mensagem privada");
    const decrypted = await decryptMessageForRecipient("bob", aliceKey, encrypted);
    expect(decrypted.body).toBe("mensagem privada");
    expect(decrypted.attachment?.name).toBe("nota.txt");
    expect(decrypted.replyTo).toEqual({ id: "mensagem-anterior", authorName: "Bia", preview: "Mensagem anterior" });
  });
});
