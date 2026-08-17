import type { EncryptedMessage } from "./e2ee";

export type LocalProfile = {
  id: string;
  connectionCode: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  accountType?: "official" | "guest";
  username?: string;
  accountUid?: string;
  authToken?: string;
  encryptionPublicKey?: JsonWebKey;
};

export type LocalAttachment = {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string | null;
  unavailableOffline?: boolean;
};

export type LocalReplyReference = {
  id: string;
  authorName: string;
  preview: string;
};

export type LocalMessage = {
  id: string;
  roomId: string;
  author: LocalProfile;
  body: string | null;
  attachment: LocalAttachment | null;
  attachmentUnavailable?: boolean;
  createdAt: string;
  encrypted?: EncryptedMessage;
  reactions?: Record<string, string[]>;
  replyTo?: LocalReplyReference;
  editedAt?: string;
  pinnedAt?: string;
  deletedAt?: string;
  deletedBy?: string;
  groupInvite?: LocalRequest;
};

export type LocalChannel = { id: string; name: string; kind?: "text" | "voice" };
export type LocalGroupMemberProfile = { displayName?: string; tag?: string; tagColor?: string; role?: "owner" | "admin" | "member" };
export type LocalGroup = {
  id: string;
  name: string;
  imageUrl: string | null;
  ownerId: string;
  admins?: string[];
  memberProfiles?: Record<string, LocalGroupMemberProfile>;
  members: LocalProfile[];
  channels: LocalChannel[];
};

export type LocalRequest = {
  id: string;
  kind: "contact" | "group";
  from: LocalProfile;
  group?: LocalGroup;
  createdAt: string;
};

export type OrbitStore = {
  profile: LocalProfile | null;
  contacts: LocalProfile[];
  groups: LocalGroup[];
  messages: Record<string, LocalMessage[]>;
  requests: LocalRequest[];
  unreadRooms?: Record<string, { count: number; mentions: number }>;
};

const STORAGE_KEY = "orbit-chat.local-store.v2";
const ACCOUNT_VAULT_KEY = "resenha-chat.account-vault.v1";
const REFRESH_TOKEN_KEY = "resenha-chat.official-refresh-tokens.v1";
const EMPTY_STORE: OrbitStore = { profile: null, contacts: [], groups: [], messages: {}, requests: [], unreadRooms: {} };

export type LocalAccountRecord = {
  id: string;
  accountType: "official" | "guest";
  username?: string;
  displayName: string;
  avatarUrl: string | null;
  connectionCode: string;
  accountUid?: string;
  store: OrbitStore;
};

function publicProfile(profile: LocalProfile): LocalProfile {
  const { authToken: _authToken, ...safeProfile } = profile;
  return safeProfile;
}

export function redactOrbitStore(store: OrbitStore): OrbitStore {
  const redactAuthor = (author: LocalProfile) => publicProfile(author);
  return {
    ...store,
    profile: store.profile ? publicProfile(store.profile) : null,
    contacts: (store.contacts || []).map(redactAuthor),
    groups: (store.groups || []).map(group => ({ ...group, members: (group.members || []).map(redactAuthor) })),
    requests: (store.requests || []).map(request => ({ ...request, from: redactAuthor(request.from), group: request.group ? { ...request.group, members: (request.group.members || []).map(redactAuthor) } : undefined })),
    messages: Object.fromEntries(Object.entries(store.messages || {}).map(([roomId, messages]) => [roomId, messages.map(message => ({ ...message, author: redactAuthor(message.author) }))])),
    unreadRooms: { ...(store.unreadRooms || {}) },
  };
}

export function replaceProfileEverywhere(store: OrbitStore, profile: LocalProfile): OrbitStore {
  const merge = (current: LocalProfile) => current.id === profile.id ? { ...current, ...profile } : current;
  return {
    ...store,
    profile: store.profile ? merge(store.profile) : null,
    contacts: (store.contacts || []).map(merge),
    groups: (store.groups || []).map(group => ({ ...group, members: (group.members || []).map(merge) })),
    requests: (store.requests || []).map(request => ({ ...request, from: merge(request.from), group: request.group ? { ...request.group, members: (request.group.members || []).map(merge) } : undefined })),
    messages: Object.fromEntries(Object.entries(store.messages || {}).map(([roomId, messages]) => [roomId, messages.map(message => ({ ...message, author: merge(message.author) }))])),
  };
}

function accountRecordFromStore(store: OrbitStore): LocalAccountRecord | null {
  const profile = store.profile;
  if (!profile) return null;
  return { id: profile.id, accountType: profile.accountType === "official" ? "official" : "guest", username: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl, connectionCode: profile.connectionCode, accountUid: profile.accountUid, store: redactOrbitStore(store) };
}

export function readAccountVault(storage: Storage = localStorage): LocalAccountRecord[] {
  try {
    const parsed = JSON.parse(storage.getItem(ACCOUNT_VAULT_KEY) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === "string" && item.store) as LocalAccountRecord[] : [];
  } catch {
    return [];
  }
}

export function saveAccountSnapshot(store: OrbitStore, storage: Storage = localStorage) {
  const record = accountRecordFromStore(store);
  if (!record) return readAccountVault(storage);
  const next = [...readAccountVault(storage).filter(item => item.id !== record.id), record];
  try { storage.setItem(ACCOUNT_VAULT_KEY, JSON.stringify(next)); } catch { /* A gravação principal continua protegida por writeOrbitStore. */ }
  return next;
}

export function removeAccountSnapshot(accountId: string, storage: Storage = localStorage) {
  const next = readAccountVault(storage).filter(item => item.id !== accountId);
  try { storage.setItem(ACCOUNT_VAULT_KEY, JSON.stringify(next)); } catch { /* Sem ação: a conta continua fora da lista em memória. */ }
  return next;
}

function readRefreshTokenVault(storage: Storage = localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(REFRESH_TOKEN_KEY) || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function readOfficialRefreshToken(accountId: string, storage: Storage = localStorage) {
  return readRefreshTokenVault(storage)[accountId] || null;
}

export function saveOfficialRefreshToken(accountId: string, refreshToken: string, storage: Storage = localStorage) {
  if (!accountId || !refreshToken) return;
  try {
    storage.setItem(REFRESH_TOKEN_KEY, JSON.stringify({ ...readRefreshTokenVault(storage), [accountId]: refreshToken }));
  } catch {
    // A sessão atual permanece funcional, mesmo quando o dispositivo não pode persistir a renovação.
  }
}

export function accountStoreForSwitch(record: LocalAccountRecord): OrbitStore {
  return { ...record.store, profile: record.store.profile ? { ...record.store.profile } : null };
}

export function createEmptyOrbitStore(): OrbitStore {
  return { profile: null, contacts: [], groups: [], messages: {}, requests: [], unreadRooms: {} };
}

export type OfficialSession = { uid: string; username?: string; displayName?: string; idToken?: string; refreshToken?: string };

export function applyOfficialSession(store: OrbitStore, session: OfficialSession): OrbitStore {
  if (!store.profile) return store;
  if (session.refreshToken) saveOfficialRefreshToken(session.uid, session.refreshToken);
  return { ...store, profile: { ...store.profile, id: session.uid, accountUid: session.uid, username: session.username || store.profile.username, displayName: session.displayName || store.profile.displayName, accountType: "official", authToken: session.idToken || store.profile.authToken } };
}

export type OrbitStoreWriteResult = {
  saved: boolean;
  store: OrbitStore;
  droppedAttachments: number;
  clearedProfileAvatar: boolean;
};

export function readOrbitStore(): OrbitStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STORE;
    const parsed = JSON.parse(raw) as Partial<OrbitStore>;
    return {
      profile: parsed.profile ?? null,
      contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      messages: parsed.messages && typeof parsed.messages === "object" ? parsed.messages : {},
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      unreadRooms: parsed.unreadRooms && typeof parsed.unreadRooms === "object" ? parsed.unreadRooms : {},
    };
  } catch {
    return EMPTY_STORE;
  }
}

function isQuotaExceeded(error: unknown) {
  return error instanceof DOMException
    ? error.name === "QuotaExceededError" || error.code === 22
    : typeof error === "object" && error !== null && "name" in error && (error as { name?: unknown }).name === "QuotaExceededError";
}

function cloneOrbitStore(store: OrbitStore): OrbitStore {
  return {
    ...store,
    profile: store.profile ? { ...store.profile } : null,
    contacts: [...store.contacts],
    groups: [...store.groups],
    messages: Object.fromEntries(Object.entries(store.messages).map(([roomId, messages]) => [roomId, messages.map(message => ({ ...message, attachment: message.attachment ? { ...message.attachment } : null }))])),
    unreadRooms: { ...(store.unreadRooms || {}) },
  };
}

function tryWrite(storage: Storage, store: OrbitStore) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch (error) {
    return !isQuotaExceeded(error) && false;
  }
}

export function writeOrbitStore(store: OrbitStore, storage: Storage = localStorage): OrbitStoreWriteResult {
  const persistedStore = redactOrbitStore(store);
  if (tryWrite(storage, persistedStore)) {
    if (persistedStore.profile) saveAccountSnapshot(persistedStore, storage);
    return { saved: true, store, droppedAttachments: 0, clearedProfileAvatar: false };
  }

  const compacted = cloneOrbitStore(persistedStore);
  const attachments = Object.entries(compacted.messages)
    .flatMap(([roomId, messages]) => messages.map((message, index) => ({ roomId, index, createdAt: message.createdAt, hasAttachment: Boolean(message.attachment) })))
    .filter(item => item.hasAttachment)
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));

  let droppedAttachments = 0;
  for (const candidate of attachments) {
    const message = compacted.messages[candidate.roomId]?.[candidate.index];
    if (!message?.attachment) continue;
    message.attachment = null;
    message.attachmentUnavailable = true;
    droppedAttachments += 1;
    if (tryWrite(storage, compacted)) {
      if (compacted.profile) saveAccountSnapshot(compacted, storage);
      return { saved: true, store: { ...compacted, profile: store.profile }, droppedAttachments, clearedProfileAvatar: false };
    }
  }

  if (compacted.profile?.avatarUrl) {
    compacted.profile.avatarUrl = null;
    if (tryWrite(storage, compacted)) {
      if (compacted.profile) saveAccountSnapshot(compacted, storage);
      return { saved: true, store: { ...compacted, profile: store.profile }, droppedAttachments, clearedProfileAvatar: true };
    }
  }

  return { saved: false, store, droppedAttachments: 0, clearedProfileAvatar: false };
}

export function createId() {
  return crypto.randomUUID();
}

export function createConnectionCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(values, value => alphabet[value % alphabet.length]).join("");
}

export function directRoomId(firstId: string, secondId: string) {
  return `dm:${[firstId, secondId].sort().join(":")}`;
}

export function channelRoomId(groupId: string, channelId: string) {
  return `channel:${groupId}:${channelId}`;
}

export function voiceRoomId(groupId: string, channelId: string) {
  return `voice:${groupId}:${channelId}`;
}

export function upsertContact(contacts: LocalProfile[], profile: LocalProfile) {
  const index = contacts.findIndex(contact => contact.id === profile.id);
  if (index < 0) return [...contacts, profile];
  return contacts.map(contact => contact.id === profile.id ? profile : contact);
}

export function appendMessage(messages: Record<string, LocalMessage[]>, message: LocalMessage) {
  const current = messages[message.roomId] || [];
  if (current.some(item => item.id === message.id)) return messages;
  return { ...messages, [message.roomId]: [...current, message] };
}

export function updateMessage(messages: Record<string, LocalMessage[]>, roomId: string, messageId: string, updater: (message: LocalMessage) => LocalMessage) {
  const current = messages[roomId] || [];
  return { ...messages, [roomId]: current.map(message => message.id === messageId ? updater(message) : message) };
}

export function deleteMessagesByAuthor(messages: Record<string, LocalMessage[]>, roomId: string, authorId: string, deletedBy: string, deletedAt = new Date().toISOString()) {
  const current = messages[roomId] || [];
  return { ...messages, [roomId]: current.map(message => message.author.id === authorId ? { ...message, body: null, attachment: null, encrypted: undefined, reactions: {}, deletedAt, deletedBy } : message) };
}

export function migrateDirectRoomId(roomId: string, guestId: string, officialId: string) {
  if (!roomId.startsWith("dm:")) return roomId;
  const participants = roomId.slice(3).split(":");
  if (!participants.includes(guestId)) return roomId;
  return `dm:${participants.map(participant => participant === guestId ? officialId : participant).sort().join(":")}`;
}

export function migrateGuestToOfficial(store: OrbitStore, officialProfile: LocalProfile): OrbitStore {
  const guest = store.profile;
  if (!guest || guest.accountType !== "guest") return { ...store, profile: officialProfile };
  const replaceAuthor = (author: LocalProfile) => author.id === guest.id ? officialProfile : author;
  return {
    ...store,
    profile: officialProfile,
    contacts: store.contacts.map(replaceAuthor),
    requests: store.requests.map(request => ({ ...request, from: replaceAuthor(request.from), group: request.group ? { ...request.group, members: request.group.members.map(replaceAuthor), ownerId: request.group.ownerId === guest.id ? officialProfile.id : request.group.ownerId } : undefined })),
    groups: store.groups.map(group => ({ ...group, ownerId: group.ownerId === guest.id ? officialProfile.id : group.ownerId, members: group.members.map(replaceAuthor) })),
    messages: Object.entries(store.messages).reduce<Record<string, LocalMessage[]>>((next, [roomId, messages]) => {
      const migratedRoomId = migrateDirectRoomId(roomId, guest.id, officialProfile.id);
      next[migratedRoomId] = [...(next[migratedRoomId] || []), ...messages.map(message => ({ ...message, roomId: migratedRoomId, author: replaceAuthor(message.author) }))];
      return next;
    }, {}),
  };
}
