import { webcrypto } from "node:crypto";
import { io } from "socket.io-client";
import {
  decryptAccountSnapshot,
  encryptAccountSnapshot,
  fetchAccountSnapshot,
  saveAccountSnapshotToDrive,
} from "../client/src/lib/accountDriveSync.ts";
import {
  decryptMessageForRecipient,
  encryptMessageForRecipients,
  ensureEncryptionPublicKey,
  exportStoredKeyPair,
  restoreStoredKeyPair,
} from "../client/src/lib/e2ee.ts";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

globalThis.localStorage = new MemoryStorage();

const api = "https://resenhudochat.onrender.com";
const runId = Date.now().toString(36).slice(-7);
const password = `Qa!Persist_${runId}9`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function post(path, body) {
  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.account) throw new Error(result.message || `Falha em ${path}`);
  return result.account;
}

async function register(suffix, displayName) {
  return post("/api/account/register", { username: `qa_${suffix}_${runId}`, password, displayName });
}

function profile(account, displayName, publicKey) {
  return {
    id: account.uid,
    accountUid: account.uid,
    username: account.username,
    authToken: account.idToken,
    accountType: "official",
    connectionCode: `QA${account.uid.slice(-4).toUpperCase()}`,
    displayName,
    bio: `conta de teste ${runId}`,
    avatarUrl: null,
    encryptionPublicKey: publicKey,
  };
}

function emitAck(socket, event, payload, timeout = 12_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Tempo esgotado em ${event}`)), timeout);
    socket.emit(event, payload, result => { clearTimeout(timer); resolve(result); });
  });
}

function waitFor(socket, event, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`Evento ${event} não chegou`)); }, timeout);
    const listener = value => { clearTimeout(timer); resolve(value); };
    socket.once(event, listener);
  });
}

function connect(accountProfile) {
  const socket = io(api, {
    path: "/api/socket.io",
    transports: ["polling", "websocket"],
    auth: { profile: accountProfile },
    autoConnect: false,
    reconnection: false,
  });
  return socket;
}

async function awaitConnected(socket) {
  const result = await Promise.race([
    waitFor(socket, "connect", 15_000),
    waitFor(socket, "connect_error", 15_000).then(error => { throw new Error(error?.message || "Falha ao conectar"); }),
  ]);
  return result;
}

async function connectAndWait(socket) {
  if (socket.connected) return;
  const connected = awaitConnected(socket);
  socket.connect();
  await connected;
}

async function disconnectAndWait(socket) {
  if (!socket.connected) return;
  const disconnected = waitFor(socket, "disconnect", 10_000);
  socket.disconnect();
  await disconnected;
}

async function pullPending(socket, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    socket.emit("pending:pull");
    if (attempt + 1 < attempts) await sleep(3_000);
  }
}

async function saveAndReadSnapshot(account, accountProfile, contactProfile, label) {
  const roomId = `dm:${[accountProfile.id, contactProfile.id].sort().join(":")}`;
  const encrypted = await encryptMessageForRecipients(accountProfile.id, [contactProfile], {
    body: `mensagem ${label}`,
    attachment: null,
  });
  const store = {
    profile: accountProfile,
    contacts: [contactProfile],
    groups: [{ id: `qa-group-${label}`, name: `QA ${label}`, imageUrl: null, ownerId: accountProfile.id, admins: [accountProfile.id], members: [accountProfile, contactProfile], channels: [{ id: "general", name: "geral", kind: "text" }] }],
    messages: {
      [roomId]: [
        { id: `qa-text-${label}`, roomId, author: accountProfile, body: null, attachment: null, createdAt: new Date().toISOString(), encrypted },
        { id: `qa-gif-${label}`, roomId, author: accountProfile, body: null, attachment: { name: "", mimeType: "image/gif", size: 43, dataUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", sentAsMessage: "gif" }, createdAt: new Date().toISOString() },
        { id: `qa-sticker-${label}`, roomId, author: contactProfile, body: null, attachment: { name: "", mimeType: "image/webp", size: 16, dataUrl: "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA=", sentAsMessage: "sticker" }, createdAt: new Date().toISOString() },
        { id: `qa-file-${label}`, roomId, author: accountProfile, body: "arquivo", attachment: { name: "qa-anexo.zip", mimeType: "application/zip", size: 3, dataUrl: "data:application/zip;base64,UEsD" }, createdAt: new Date().toISOString() },
      ],
    },
    requests: [{ id: `qa-group-request-${label}`, kind: "group", from: contactProfile, group: { id: `qa-invite-${label}`, name: "Convite QA", imageUrl: null, ownerId: contactProfile.id, members: [contactProfile], channels: [{ id: "general", name: "geral", kind: "text" }] }, createdAt: new Date().toISOString() }],
    outgoingRequests: [{ id: `qa-contact-request-${label}`, kind: "contact", to: contactProfile, createdAt: new Date().toISOString() }],
    unreadRooms: { [roomId]: { count: 2, mentions: 1 } },
  };
  const current = await fetchAccountSnapshot(`${api}/api/account/sync`, account.uid, account.idToken);
  const snapshot = await encryptAccountSnapshot(password, { store, keyPair: exportStoredKeyPair(account.uid) });
  const saved = await saveAccountSnapshotToDrive(`${api}/api/account/sync`, account.uid, account.idToken, current.revision, snapshot);
  assert(!saved.conflict, `Snapshot ${label} entrou em conflito`);
  const loaded = await fetchAccountSnapshot(`${api}/api/account/sync`, account.uid, account.idToken);
  assert(loaded.snapshot, `Snapshot ${label} não foi recuperado`);
  const restored = await decryptAccountSnapshot(password, loaded.snapshot);
  assert(restored.store.contacts.some(contact => contact.id === contactProfile.id), `Contato ${label} não persistiu`);
  assert(Object.values(restored.store.messages).flat().length === 4, `Mensagens/anexos ${label} não persistiram`);
  assert(restored.store.groups.length === 1 && restored.store.requests.length === 1, `Grupo ou convite ${label} não persistiu`);
  localStorage.removeItem(`resenha-chat.e2ee.keypair.${account.uid}`);
  await restoreStoredKeyPair(account.uid, restored.keyPair);
  const first = Object.values(restored.store.messages).flat()[0];
  const clear = await decryptMessageForRecipient(account.uid, accountProfile.encryptionPublicKey, first.encrypted);
  assert(clear.body === `mensagem ${label}`, `Mensagem criptografada ${label} não abriu após restaurar a chave`);
}

const openedSockets = [];
try {
  const first = await register("a", "QA Persist A");
  const second = await register("b", "QA Persist B");
  const [firstKey, secondKey] = await Promise.all([ensureEncryptionPublicKey(first.uid), ensureEncryptionPublicKey(second.uid)]);
  const firstProfile = profile(first, "QA Persist A", firstKey);
  const secondProfile = profile(second, "QA Persist B", secondKey);

  await saveAndReadSnapshot(first, firstProfile, secondProfile, "a");
  await saveAndReadSnapshot(second, secondProfile, firstProfile, "b");

  const sender = connect(firstProfile);
  const targetRegistration = connect(secondProfile);
  openedSockets.push(sender, targetRegistration);
  await Promise.all([connectAndWait(sender), connectAndWait(targetRegistration)]);
  await disconnectAndWait(targetRegistration);
  await sleep(5_000);

  const offlineRequest = waitFor(targetRegistration, "contact:request", 60_000);
  const requestResult = await emitAck(sender, "contact:add-username", { username: second.username });
  assert(requestResult.ok, `Solicitação offline falhou: ${requestResult.message || "erro desconhecido"}`);
  await sleep(3_000);
  await connectAndWait(targetRegistration);
  await pullPending(targetRegistration);
  const requestEvent = await offlineRequest;
  if (requestEvent.pendingDeliveryId) targetRegistration.emit("pending:ack", { pendingDeliveryId: requestEvent.pendingDeliveryId, pendingDeliveryKind: requestEvent.pendingDeliveryKind });

  const addedOnSender = waitFor(sender, "contact:added");
  targetRegistration.emit("contact:resolve", { request: requestEvent.request, accepted: true });
  await addedOnSender;
  await disconnectAndWait(targetRegistration);

  const roomId = `dm:${[first.uid, second.uid].sort().join(":")}`;
  const directResult = await emitAck(sender, "direct:message", { recipientId: second.uid, message: { id: `qa-direct-${runId}`, roomId, body: null, attachment: null, encrypted: await encryptMessageForRecipients(first.uid, [secondProfile], { body: "offline", attachment: null }), createdAt: new Date().toISOString() } });
  assert(directResult.ok, "Mensagem offline não foi aceita pelo servidor");

  const group = { id: `qa-server-${runId}`, name: "Servidor QA", imageUrl: null, ownerId: first.uid, admins: [first.uid], members: [firstProfile], channels: [{ id: "general", name: "geral", kind: "text" }] };
  const inviteResult = await emitAck(sender, "group:invite", { code: secondProfile.connectionCode, contact: secondProfile, group });
  assert(inviteResult.ok, "Convite de servidor offline não foi aceito");
  const historyResult = await emitAck(sender, "group:history", { recipientId: second.uid, groupId: group.id, messages: [{ id: `qa-history-${runId}`, roomId: `channel:${group.id}:general`, author: firstProfile, body: null, attachment: null, encrypted: await encryptMessageForRecipients(first.uid, [secondProfile], { body: "histórico", attachment: null }), createdAt: new Date().toISOString() }] });
  assert(historyResult.ok, "Histórico de servidor não foi aceito");

  const received = { direct: null, invite: null, history: null };
  const receiveDirect = waitFor(targetRegistration, "direct:message", 60_000).then(value => { received.direct = value; return value; });
  const receiveInvite = waitFor(targetRegistration, "group:invite-message", 60_000).then(value => { received.invite = value; return value; });
  const receiveHistory = waitFor(targetRegistration, "group:history", 60_000).then(value => { received.history = value; return value; });
  await connectAndWait(targetRegistration);
  await pullPending(targetRegistration);
  const [direct, invite, history] = await Promise.all([receiveDirect, receiveInvite, receiveHistory]);
  for (const item of [direct, invite, history]) {
    if (item.pendingDeliveryId) targetRegistration.emit("pending:ack", { pendingDeliveryId: item.pendingDeliveryId, pendingDeliveryKind: item.pendingDeliveryKind });
  }
  await sleep(1_000);
  console.log(JSON.stringify({ ok: true, runId, checks: ["snapshots", "contatos", "mensagens", "anexos", "gif", "figurinha", "convite", "histórico", "fila-offline"] }));
} finally {
  openedSockets.forEach(socket => socket.disconnect());
}
