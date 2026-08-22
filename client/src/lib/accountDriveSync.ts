import type { LocalGroup, LocalMessage, LocalProfile, OrbitStore } from "./localOrbit";

export type EncryptedAccountSnapshot = {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
  updatedAt: number;
};

export type AccountSyncPayload = {
  store: OrbitStore;
  keyPair: { privateKey: JsonWebKey; publicKey: JsonWebKey } | null;
};

export type AccountDriveMedia = { dataUrl: string; previewDataUrl?: string | null };

function canonicalizeSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeSnapshotValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonicalizeSnapshotValue(record[key])]));
  }
  return value;
}

export function stableSnapshotSignature(store: unknown) {
  return JSON.stringify(canonicalizeSnapshotValue(store));
}

function uniqueById<T extends { id: string }>(remote: T[], local: T[]) {
  return Array.from(new Map([...remote, ...local].map(item => [item.id, item])).values());
}

function mergeGroup(remote: LocalGroup, local: LocalGroup): LocalGroup {
  return {
    ...remote,
    ...local,
    members: uniqueById(remote.members || [], local.members || []),
    channels: uniqueById(remote.channels || [], local.channels || []),
    admins: Array.from(new Set([...(remote.admins || []), ...(local.admins || [])])),
    memberProfiles: { ...(remote.memberProfiles || {}), ...(local.memberProfiles || {}) },
  };
}

function mergeMessages(remote: Record<string, LocalMessage[]>, local: Record<string, LocalMessage[]>) {
  return Object.fromEntries(Array.from(new Set([...Object.keys(remote || {}), ...Object.keys(local || {})])).map(roomId => [roomId, uniqueById(remote?.[roomId] || [], local?.[roomId] || []).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))]));
}

export function mergeAccountStores(remote: OrbitStore, local: OrbitStore): OrbitStore {
  const remoteGroups = new Map((remote.groups || []).map(group => [group.id, group]));
  const groups = (local.groups || []).reduce<LocalGroup[]>((all, localGroup) => {
    const remoteGroup = remoteGroups.get(localGroup.id);
    remoteGroups.delete(localGroup.id);
    all.push(remoteGroup ? mergeGroup(remoteGroup, localGroup) : localGroup);
    return all;
  }, []);
  groups.push(...Array.from(remoteGroups.values()));
  return {
    ...remote,
    ...local,
    profile: local.profile ? { ...(remote.profile || {} as LocalProfile), ...local.profile } : remote.profile,
    contacts: uniqueById(remote.contacts || [], local.contacts || []),
    groups,
    requests: uniqueById(remote.requests || [], local.requests || []),
    messages: mergeMessages(remote.messages || {}, local.messages || {}),
    unreadRooms: { ...(remote.unreadRooms || {}), ...(local.unreadRooms || {}) },
  };
}

export function restoreAccountStore(remote: OrbitStore, local: OrbitStore): OrbitStore {
  return mergeAccountStores(local, remote);
}

export function mergeHydratedDriveMedia(current: OrbitStore, hydrated: OrbitStore): OrbitStore {
  const mediaById = new Map<string, NonNullable<LocalMessage["attachment"]>>();
  for (const messages of Object.values(hydrated.messages || {})) {
    for (const message of messages) {
      const attachment = message.attachment;
      if (attachment?.driveMediaId && attachment.dataUrl) mediaById.set(attachment.driveMediaId, attachment);
    }
  }
  if (!mediaById.size) return current;
  return {
    ...current,
    messages: Object.fromEntries(Object.entries(current.messages || {}).map(([roomId, messages]) => [roomId, messages.map(message => {
      const attachment = message.attachment;
      const refreshed = attachment?.driveMediaId ? mediaById.get(attachment.driveMediaId) : null;
      if (!attachment || !refreshed) return message;
      const updatedAttachment = { ...attachment, dataUrl: refreshed.dataUrl, previewDataUrl: refreshed.previewDataUrl ?? attachment.previewDataUrl, unavailableOffline: false };
      return { ...message, attachment: updatedAttachment };
    })])),
  };
}

type SyncReadResponse = { ok: boolean; revision?: number; snapshot?: EncryptedAccountSnapshot | null; message?: string };
type SyncWriteResponse = SyncReadResponse & { conflict?: boolean };
type MediaReadResponse = { ok: boolean; media?: EncryptedAccountSnapshot; message?: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function deriveSnapshotKey(password: string, salt: Uint8Array, usage: KeyUsage[]) {
  const source = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: 180_000, hash: "SHA-256" }, source, { name: "AES-GCM", length: 256 }, false, usage);
}

export async function encryptAccountSnapshot(password: string, payload: AccountSyncPayload): Promise<EncryptedAccountSnapshot> {
  if (!password) throw new Error("Informe a senha para proteger os dados da conta.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveSnapshotKey(password, salt, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(payload)));
  return { version: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)), updatedAt: Date.now() };
}

export async function decryptAccountSnapshot(password: string, snapshot: EncryptedAccountSnapshot): Promise<AccountSyncPayload> {
  if (!snapshot || snapshot.version !== 1) throw new Error("Os dados sincronizados desta conta não são compatíveis.");
  const key = await deriveSnapshotKey(password, base64ToBytes(snapshot.salt), ["decrypt"]);
  const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(snapshot.iv) }, key, base64ToBytes(snapshot.ciphertext));
  const payload = JSON.parse(decoder.decode(bytes)) as AccountSyncPayload;
  if (!payload?.store || typeof payload.store !== "object") throw new Error("Os dados sincronizados desta conta estão inválidos.");
  return payload;
}

export async function encryptAccountDriveMedia(password: string, media: AccountDriveMedia): Promise<EncryptedAccountSnapshot> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveSnapshotKey(password, salt, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(media)));
  return { version: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)), updatedAt: Date.now() };
}

export async function decryptAccountDriveMedia(password: string, media: EncryptedAccountSnapshot): Promise<AccountDriveMedia> {
  const key = await deriveSnapshotKey(password, base64ToBytes(media.salt), ["decrypt"]);
  const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(media.iv) }, key, base64ToBytes(media.ciphertext));
  const payload = JSON.parse(decoder.decode(bytes)) as Partial<AccountDriveMedia>;
  if (!payload || typeof payload.dataUrl !== "string") throw new Error("A mídia salva está inválida.");
  return { dataUrl: payload.dataUrl, previewDataUrl: typeof payload.previewDataUrl === "string" || payload.previewDataUrl === null ? payload.previewDataUrl : undefined };
}

function headers(accountId: string, idToken: string) {
  return { "content-type": "application/json", authorization: `Bearer ${idToken}`, "x-resenha-account-id": accountId };
}

export async function fetchAccountSnapshot(endpoint: string, accountId: string, idToken: string, request: typeof fetch = fetch) {
  const separator = endpoint.includes("?") ? "&" : "?";
  const response = await request(`${endpoint}${separator}fresh=${Date.now()}-${Math.random().toString(36).slice(2)}`, { headers: headers(accountId, idToken), cache: "no-store" });
  const result = await response.json() as SyncReadResponse;
  if (!response.ok || !result.ok) throw new Error(result.message || "Não foi possível carregar os dados da conta.");
  return { revision: result.revision || 0, snapshot: result.snapshot || null };
}

export async function saveAccountSnapshotToDrive(endpoint: string, accountId: string, idToken: string, revision: number, snapshot: EncryptedAccountSnapshot, request: typeof fetch = fetch) {
  const response = await request(endpoint, { method: "PUT", headers: headers(accountId, idToken), body: JSON.stringify({ revision, snapshot }) });
  const result = await response.json() as SyncWriteResponse;
  if (response.status === 409 && result.conflict) return { conflict: true as const, revision: result.revision || 0, snapshot: result.snapshot || null };
  if (!response.ok || !result.ok) throw syncError(response.status, result.message || "Não foi possível salvar os dados da conta.");
  return { conflict: false as const, revision: result.revision || revision + 1 };
}

function syncError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

export async function saveAccountMediaToDrive(endpoint: string, accountId: string, idToken: string, mediaId: string, media: EncryptedAccountSnapshot, request: typeof fetch = fetch) {
  const response = await request(`${endpoint}/${encodeURIComponent(mediaId)}`, { method: "PUT", headers: headers(accountId, idToken), body: JSON.stringify({ media }) });
  const result = await response.json() as MediaReadResponse;
  if (!response.ok || !result.ok) throw syncError(response.status, result.message || "Não foi possível salvar a mídia.");
}

export async function fetchAccountMediaFromDrive(endpoint: string, accountId: string, idToken: string, mediaId: string, request: typeof fetch = fetch) {
  const response = await request(`${endpoint}/${encodeURIComponent(mediaId)}`, { headers: headers(accountId, idToken) });
  const result = await response.json() as MediaReadResponse;
  if (!response.ok || !result.ok || !result.media) throw syncError(response.status, result.message || "Não foi possível carregar a mídia.");
  return result.media;
}
