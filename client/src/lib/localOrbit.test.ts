import { beforeEach, describe, expect, it } from "vitest";
import { accountStoreForSwitch, applyOfficialSession, createEmptyOrbitStore, deleteMessagesByAuthor, directRoomId, migrateGuestToOfficial, readAccountVault, readOfficialRefreshToken, readOrbitStore, replaceProfileEverywhere, saveAccountSnapshot, writeOrbitStore, type OrbitStore } from "./localOrbit";

const STORAGE_KEY = "orbit-chat.local-store.v2";

describe("writeOrbitStore", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (value.includes("data:image/png;base64,conteudo-pesado")) throw new DOMException("quota", "QuotaExceededError");
          values.set(key, value);
        },
        removeItem: (key: string) => { values.delete(key); },
        clear: () => { values.clear(); },
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        get length() { return values.size; },
      },
    });
  });

  it("não remove foto, mensagem ou anexo quando a cota local é excedida", () => {
    const store: OrbitStore = {
      profile: { id: "ana", connectionCode: "ANA123", displayName: "Ana", bio: "", avatarUrl: "data:image/png;base64,conteudo-pesado" },
      contacts: [],
      groups: [],
      requests: [],
      messages: {
        "dm:a:b": [{
          id: "message-1",
          roomId: "dm:a:b",
          author: { id: "a", connectionCode: "ABC123", displayName: "Ana", bio: "", avatarUrl: null },
          body: "Não perca este texto",
          attachment: { name: "foto.png", mimeType: "image/png", size: 12, dataUrl: "data:image/png;base64,conteudo-pesado" },
          createdAt: "2026-08-16T00:00:00.000Z",
        }],
      },
    };

    const result = writeOrbitStore(store);
    expect(result.saved).toBe(false);
    expect(result.droppedAttachments).toBe(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(result.store.profile?.avatarUrl).toBe("data:image/png;base64,conteudo-pesado");
    expect(result.store.messages["dm:a:b"][0].body).toBe("Não perca este texto");
    expect(result.store.messages["dm:a:b"][0].attachment?.dataUrl).toBe("data:image/png;base64,conteudo-pesado");
  });

  it("preserva o cartão de convite e sua resposta no histórico local", () => {
    const ana = { id: "ana", connectionCode: "ANA123", displayName: "Ana", bio: "", avatarUrl: null };
    const group = { id: "grupo", name: "Resenha", imageUrl: null, ownerId: "ana", members: [ana], channels: [] };
    const store: OrbitStore = { profile: ana, contacts: [], groups: [], requests: [], messages: { "dm:ana:bia": [{ id: "invite:1", roomId: "dm:ana:bia", author: ana, body: null, attachment: null, createdAt: "2026-08-17T00:00:00.000Z", groupInvite: { id: "group:1", kind: "group", from: ana, group, createdAt: "2026-08-17T00:00:00.000Z" }, groupInviteStatus: "accepted" }] } };

    expect(writeOrbitStore(store).saved).toBe(true);
    const restored = readOrbitStore();
    expect(restored.messages["dm:ana:bia"][0].groupInvite?.group?.name).toBe("Resenha");
    expect(restored.messages["dm:ana:bia"][0].groupInviteStatus).toBe("accepted");
  });

  it("remove reações junto com o conteúdo quando uma mensagem é excluída", () => {
    const author = { id: "ana", connectionCode: "ANA123", displayName: "Ana", bio: "", avatarUrl: null };
    const deleted = deleteMessagesByAuthor({ "dm:ana:bia": [{ id: "m1", roomId: "dm:ana:bia", author, body: "Oi", attachment: null, createdAt: "2026-08-16T00:00:00.000Z", reactions: { "👍": ["ana", "bia"] } }] }, "dm:ana:bia", "ana", "ana");
    expect(deleted["dm:ana:bia"][0]).toMatchObject({ body: null, attachment: null, reactions: {} });
  });

  it("atualiza a identidade em contatos, grupos e mensagens históricas", () => {
    const oldProfile = { id: "ana", connectionCode: "ANA123", displayName: "Ana", bio: "", avatarUrl: null };
    const refreshed = { ...oldProfile, displayName: "ANA", avatarUrl: "data:image/png;base64,nova-foto" };
    const store: OrbitStore = { profile: oldProfile, contacts: [oldProfile], groups: [{ id: "grupo", name: "Grupo", imageUrl: null, ownerId: "ana", members: [oldProfile], channels: [] }], requests: [], messages: { "dm:ana:bia": [{ id: "m1", roomId: "dm:ana:bia", author: oldProfile, body: "histórico", attachment: null, createdAt: "2026-08-16T00:00:00.000Z" }] } };
    const updated = replaceProfileEverywhere(store, refreshed);
    expect(updated.profile?.displayName).toBe("ANA");
    expect(updated.contacts[0].avatarUrl).toBe(refreshed.avatarUrl);
    expect(updated.groups[0].members[0].displayName).toBe("ANA");
    expect(updated.messages["dm:ana:bia"][0].author.avatarUrl).toBe(refreshed.avatarUrl);
  });

  it("salva múltiplas contas sem persistir tokens de autenticação", () => {
    const guest: OrbitStore = { profile: { id: "guest", connectionCode: "ABC123", displayName: "Guest", bio: "", avatarUrl: null, accountType: "guest" }, contacts: [], groups: [], requests: [], messages: {} };
    const official: OrbitStore = { profile: { id: "official", accountUid: "official", username: "ana", connectionCode: "ZXCV12", displayName: "Ana", bio: "", avatarUrl: null, accountType: "official", authToken: "token-que-nao-pode-ser-salvo" }, contacts: [], groups: [], requests: [], messages: {} };
    saveAccountSnapshot(guest);
    saveAccountSnapshot(official);
    const rawVault = localStorage.getItem("resenha-chat.account-vault.v1") || "";
    expect(rawVault).not.toContain("token-que-nao-pode-ser-salvo");
    expect(readAccountVault()).toHaveLength(2);
    expect(readAccountVault().map(account => account.id)).toEqual(["guest", "official"]);
  });

  it("preserva conversas e grupos ao transformar um perfil Guest em conta oficial", () => {
    const guest = { id: "guest", connectionCode: "ABC123", displayName: "Convidado", bio: "", avatarUrl: null, accountType: "guest" as const };
    const official = { id: "official", connectionCode: "ZXCV12", displayName: "Ana", bio: "", avatarUrl: null, accountType: "official" as const, username: "ana" };
    const store: OrbitStore = { profile: guest, contacts: [], requests: [], groups: [{ id: "group", name: "Grupo", imageUrl: null, ownerId: "guest", members: [guest], channels: [] }], messages: { "dm:guest:friend": [{ id: "message", roomId: "dm:guest:friend", author: guest, body: "histórico", attachment: null, createdAt: "2026-08-16T00:00:00.000Z" }] } };

    const migrated = migrateGuestToOfficial(store, official);
    expect(migrated.profile).toEqual(official);
    const officialRoom = directRoomId("official", "friend");
    expect(migrated.messages[officialRoom][0].author.id).toBe("official");
    expect(migrated.messages[officialRoom][0].roomId).toBe(officialRoom);
    expect(migrated.messages["dm:guest:friend"]).toBeUndefined();
    expect(migrated.groups[0].ownerId).toBe("official");
    expect(migrated.groups[0].members[0].id).toBe("official");
  });

  it("separa históricos e reidrata sessão oficial sem persistir o token", () => {
    const guest: OrbitStore = { profile: { id: "guest", connectionCode: "ABC123", displayName: "Guest", bio: "", avatarUrl: null, accountType: "guest" }, contacts: [], groups: [], requests: [], messages: { "dm:guest:friend": [] } };
    const official: OrbitStore = { profile: { id: "official", accountUid: "uid", username: "ana", connectionCode: "ZXCV12", displayName: "Ana", bio: "", avatarUrl: null, accountType: "official" }, contacts: [], groups: [], requests: [], messages: { "dm:official:friend": [] } };
    saveAccountSnapshot(guest);
    saveAccountSnapshot(official);
    const selected = accountStoreForSwitch(readAccountVault().find(account => account.id === "official")!);
    expect(selected?.messages["dm:official:friend"]).toEqual([]);
    expect(selected?.messages["dm:guest:friend"]).toBeUndefined();
    const session = applyOfficialSession(selected!, { uid: "official", username: "ana", idToken: "novo-token", refreshToken: "refresh-privado" });
    expect(session.profile?.authToken).toBe("novo-token");
    saveAccountSnapshot(session);
    expect(localStorage.getItem("resenha-chat.account-vault.v1")).not.toContain("novo-token");
    expect(readOfficialRefreshToken("official")).toBe("refresh-privado");
  });

  it("reabre o histórico oficial após encerrar a sessão e entrar novamente com senha", () => {
    const guest: OrbitStore = { profile: { id: "guest", connectionCode: "ABC123", displayName: "Guest", bio: "", avatarUrl: null, accountType: "guest" }, contacts: [], groups: [], requests: [], messages: { "dm:guest:friend": [] } };
    const official: OrbitStore = { profile: { id: "official", accountUid: "official", username: "ana", connectionCode: "ZXCV12", displayName: "Ana", bio: "", avatarUrl: null, accountType: "official" }, contacts: [], groups: [], requests: [], messages: { "dm:official:friend": [{ id: "history", roomId: "dm:official:friend", author: guest.profile!, body: "histórico oficial", attachment: null, createdAt: "2026-08-16T00:00:00.000Z" }] } };
    saveAccountSnapshot(guest);
    saveAccountSnapshot(official);
    const loggedOut = createEmptyOrbitStore();
    expect(loggedOut.profile).toBeNull();
    const record = readAccountVault().find(account => account.id === "official")!;
    const reentered = applyOfficialSession(accountStoreForSwitch(record), { uid: "official", username: "ana", idToken: "token-recebido-apos-senha" });
    expect(reentered.messages["dm:official:friend"][0].body).toBe("histórico oficial");
    expect(reentered.messages["dm:guest:friend"]).toBeUndefined();
    saveAccountSnapshot(reentered);
    expect(localStorage.getItem("resenha-chat.account-vault.v1")).not.toContain("token-recebido-apos-senha");
  });

  it("persiste a vida social e o envelope E2EE no cofre da própria conta", () => {
    const profile = { id: "ana", connectionCode: "ANA123", displayName: "Ana", bio: "Oi", avatarUrl: "data:image/png;base64,avatar", accountType: "official" as const, username: "ana", encryptionPublicKey: { kty: "EC", crv: "P-256", x: "x", y: "y", ext: true } };
    const contact = { id: "bia", connectionCode: "BIA123", displayName: "Bia", bio: "", avatarUrl: null, encryptionPublicKey: { kty: "EC", crv: "P-256", x: "x2", y: "y2", ext: true } };
    const store: OrbitStore = {
      profile,
      contacts: [contact],
      groups: [{ id: "grupo", name: "Teste", imageUrl: null, ownerId: "ana", members: [profile, contact], channels: [{ id: "geral", name: "geral" }] }],
      requests: [{ id: "pedido", kind: "contact", from: contact, createdAt: "2026-08-16T00:00:00.000Z" }],
      unreadRooms: { "dm:ana:bia": { count: 2, mentions: 1 } },
      messages: { "dm:ana:bia": [{ id: "segura", roomId: "dm:ana:bia", author: contact, body: "Mensagem local", attachment: null, createdAt: "2026-08-16T00:00:00.000Z", encrypted: { version: 1, recipients: { ana: { version: 1, iv: "iv", ciphertext: "cipher" } } } }] },
    };

    expect(writeOrbitStore(store).saved).toBe(true);
    expect(readOrbitStore().messages["dm:ana:bia"][0].encrypted?.recipients.ana.ciphertext).toBe("cipher");
    const restored = accountStoreForSwitch(readAccountVault().find(account => account.id === "ana")!);
    expect(restored.contacts[0].displayName).toBe("Bia");
    expect(restored.groups[0].channels[0].name).toBe("geral");
    expect(restored.requests[0].id).toBe("pedido");
    expect(restored.unreadRooms?.["dm:ana:bia"].mentions).toBe(1);
  });
});
