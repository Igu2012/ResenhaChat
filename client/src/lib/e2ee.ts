import type { LocalAttachment, LocalReplyReference } from "./localOrbit";

const KEY_STORAGE_PREFIX = "resenha-chat.e2ee.keypair.";
const DRIVE_PASSWORD_STORAGE_PREFIX = "resenha-chat.drive-password.";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type EncryptedPayload = {
  version: 1;
  iv: string;
  ciphertext: string;
};

export type EncryptedMessage = {
  version: 1;
  recipients: Record<string, EncryptedPayload>;
};

export type ClearMessageContent = {
  body: string | null;
  attachment: LocalAttachment | null;
  replyTo?: LocalReplyReference;
};

export type StoredKeyPair = { privateKey: JsonWebKey; publicKey: JsonWebKey };

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function importStoredKeyPair(stored: StoredKeyPair): Promise<CryptoKeyPair> {
  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.importKey("jwk", stored.privateKey, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]),
    crypto.subtle.importKey("jwk", stored.publicKey, { name: "ECDH", namedCurve: "P-256" }, true, []),
  ]);
  return { privateKey, publicKey };
}

async function deviceKeyPair(profileId: string): Promise<CryptoKeyPair> {
  const storageKey = `${KEY_STORAGE_PREFIX}${profileId}`;
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    try {
      return await importStoredKeyPair(JSON.parse(saved) as StoredKeyPair);
    } catch {
      localStorage.removeItem(storageKey);
    }
  }
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.privateKey),
    crypto.subtle.exportKey("jwk", pair.publicKey),
  ]);
  localStorage.setItem(storageKey, JSON.stringify({ privateKey, publicKey } satisfies StoredKeyPair));
  return pair;
}

export async function ensureEncryptionPublicKey(profileId: string) {
  const pair = await deviceKeyPair(profileId);
  return crypto.subtle.exportKey("jwk", pair.publicKey);
}

export function exportStoredKeyPair(profileId: string): StoredKeyPair | null {
  try {
    const raw = localStorage.getItem(`${KEY_STORAGE_PREFIX}${profileId}`);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredKeyPair;
    if (!stored?.privateKey || !stored?.publicKey) return null;
    return stored;
  } catch {
    return null;
  }
}

export async function restoreStoredKeyPair(profileId: string, stored: StoredKeyPair | null | undefined) {
  if (!stored?.privateKey || !stored?.publicKey) return;
  await importStoredKeyPair(stored);
  localStorage.setItem(`${KEY_STORAGE_PREFIX}${profileId}`, JSON.stringify(stored));
}

async function sharedCipher(profileId: string, peerPublicKey: JsonWebKey, usage: KeyUsage[]) {
  const [pair, peer] = await Promise.all([
    deviceKeyPair(profileId),
    crypto.subtle.importKey("jwk", peerPublicKey, { name: "ECDH", namedCurve: "P-256" }, true, []),
  ]);
  return crypto.subtle.deriveKey({ name: "ECDH", public: peer }, pair.privateKey, { name: "AES-GCM", length: 256 }, false, usage);
}

async function deviceStorageCipher(profileId: string, usage: KeyUsage[]) {
  const pair = await deviceKeyPair(profileId);
  return crypto.subtle.deriveKey({ name: "ECDH", public: pair.publicKey }, pair.privateKey, { name: "AES-GCM", length: 256 }, false, usage);
}

export async function saveDriveSyncPassword(profileId: string, password: string) {
  if (!profileId || !password) return;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await deviceStorageCipher(profileId, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cipher, encoder.encode(password));
  localStorage.setItem(`${DRIVE_PASSWORD_STORAGE_PREFIX}${profileId}`, JSON.stringify({ iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)) }));
}

export async function readDriveSyncPassword(profileId: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(`${DRIVE_PASSWORD_STORAGE_PREFIX}${profileId}`) || "null") as { iv?: string; ciphertext?: string } | null;
    if (!saved?.iv || !saved.ciphertext) return null;
    const cipher = await deviceStorageCipher(profileId, ["decrypt"]);
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(saved.iv) }, cipher, base64ToBytes(saved.ciphertext));
    return decoder.decode(bytes) || null;
  } catch {
    return null;
  }
}

async function encryptForRecipient(profileId: string, recipientPublicKey: JsonWebKey, content: ClearMessageContent): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await sharedCipher(profileId, recipientPublicKey, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cipher, encoder.encode(JSON.stringify(content)));
  return { version: 1, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function encryptMessageForRecipients(profileId: string, recipients: Array<{ id: string; encryptionPublicKey?: JsonWebKey }>, content: ClearMessageContent): Promise<EncryptedMessage> {
  const ownRecipient = { id: profileId, encryptionPublicKey: await ensureEncryptionPublicKey(profileId) };
  const uniqueRecipients = Array.from(new Map([...recipients, ownRecipient].map(recipient => [recipient.id, recipient])).values());
  if (!uniqueRecipients.length) return { version: 1, recipients: {} };
  if (uniqueRecipients.some(recipient => !recipient.encryptionPublicKey)) throw new Error("Um participante ainda não preparou a chave de criptografia. Peça para abrir a versão mais recente da Resenha Chat.");
  const encrypted = await Promise.all(uniqueRecipients.map(async recipient => [recipient.id, await encryptForRecipient(profileId, recipient.encryptionPublicKey!, content)] as const));
  return { version: 1, recipients: Object.fromEntries(encrypted) };
}

export async function decryptMessageForRecipient(profileId: string, senderPublicKey: JsonWebKey | undefined, encrypted: EncryptedMessage): Promise<ClearMessageContent> {
  const envelope = encrypted.recipients[profileId];
  if (!senderPublicKey || !envelope || encrypted.version !== 1 || envelope.version !== 1) throw new Error("Envelope criptografado indisponível para este dispositivo.");
  const cipher = await sharedCipher(profileId, senderPublicKey, ["decrypt"]);
  const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(envelope.iv) }, cipher, base64ToBytes(envelope.ciphertext));
  const content = JSON.parse(decoder.decode(data)) as ClearMessageContent;
  const replyTo = content.replyTo && typeof content.replyTo.id === "string" && typeof content.replyTo.authorName === "string" && typeof content.replyTo.preview === "string"
    ? { id: content.replyTo.id, authorName: content.replyTo.authorName, preview: content.replyTo.preview.slice(0, 180) }
    : undefined;
  return { body: typeof content.body === "string" ? content.body : null, attachment: content.attachment || null, replyTo };
}

export function isEncryptedMessage(value: unknown): value is EncryptedMessage {
  const message = value as Partial<EncryptedMessage> | null;
  return Boolean(message && message.version === 1 && message.recipients && typeof message.recipients === "object");
}
