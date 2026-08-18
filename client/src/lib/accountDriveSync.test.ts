import { describe, expect, it } from "vitest";
import { decryptAccountSnapshot, encryptAccountSnapshot, mergeAccountStores, restoreAccountStore } from "./accountDriveSync";

describe("cofre de conta no Drive", () => {
  it("cifra o snapshot com a senha antes de prepará-lo para sincronização", async () => {
    const payload = { store: { profile: null, contacts: [], groups: [], messages: {}, requests: {}, unreadRooms: {} }, keyPair: null } as never;
    const snapshot = await encryptAccountSnapshot("SenhaSegura1", payload);

    expect(JSON.stringify(snapshot)).not.toContain("contacts");
    await expect(decryptAccountSnapshot("SenhaSegura1", snapshot)).resolves.toEqual(payload);
    await expect(decryptAccountSnapshot("SenhaErrada1", snapshot)).rejects.toThrow();
  });
});

describe("mergeAccountStores", () => {
  it("mantém mensagens e membros criados em aparelhos diferentes", () => {
    const profile = { id: "ana", connectionCode: "ANA123", displayName: "Ana", bio: "", avatarUrl: null };
    const bia = { id: "bia", connectionCode: "BIA123", displayName: "Bia", bio: "", avatarUrl: null };
    const caio = { id: "caio", connectionCode: "CAI123", displayName: "Caio", bio: "", avatarUrl: null };
    const remote = { profile, contacts: [bia], requests: [], groups: [{ id: "server", name: "Resenha", imageUrl: null, ownerId: "ana", members: [profile, bia], channels: [] }], messages: { "dm:ana:bia": [{ id: "r1", roomId: "dm:ana:bia", author: bia, body: "oi", attachment: null, createdAt: "2026-08-18T12:00:00.000Z" }] } };
    const local = { profile, contacts: [caio], requests: [], groups: [{ id: "server", name: "Resenha", imageUrl: null, ownerId: "ana", members: [profile, caio], channels: [] }], messages: { "dm:ana:bia": [{ id: "l1", roomId: "dm:ana:bia", author: profile, body: "olá", attachment: null, createdAt: "2026-08-18T12:01:00.000Z" }] } };

    const merged = mergeAccountStores(remote, local);
    expect(merged.contacts.map(contact => contact.id)).toEqual(["bia", "caio"]);
    expect(merged.groups[0].members.map(member => member.id)).toEqual(["ana", "bia", "caio"]);
    expect(merged.messages["dm:ana:bia"].map(message => message.id)).toEqual(["r1", "l1"]);
  });

  it("restaura a conta completa em um segundo dispositivo vazio", async () => {
    const ana = { id: "ana", accountUid: "ana", username: "Ana", accountType: "official" as const, connectionCode: "ANA123", displayName: "Ana", bio: "Perfil salvo", avatarUrl: "data:image/png;base64,avatar" };
    const bia = { id: "bia", connectionCode: "BIA123", displayName: "Bia", bio: "", avatarUrl: null };
    const firstDevice = {
      profile: ana,
      contacts: [bia],
      requests: [{ id: "request-1", kind: "contact" as const, from: bia, createdAt: "2026-08-18T12:00:00.000Z" }],
      groups: [{ id: "server-1", name: "Resenha", imageUrl: "data:image/png;base64,server", ownerId: "ana", members: [ana, bia], channels: [{ id: "general", name: "geral" }] }],
      messages: { "dm:ana:bia": [{ id: "message-1", roomId: "dm:ana:bia", author: bia, body: "Mensagem protegida", attachment: { name: "foto.png", mimeType: "image/png", size: 32, dataUrl: "data:image/png;base64,media" }, createdAt: "2026-08-18T12:01:00.000Z" }] },
      unreadRooms: { "dm:ana:bia": { count: 1, mentions: 0 } },
    };
    const snapshot = await encryptAccountSnapshot("SenhaSegura1", { store: firstDevice, keyPair: null });
    const downloaded = await decryptAccountSnapshot("SenhaSegura1", snapshot);
    const secondDevice = { profile: null, contacts: [], groups: [], messages: {}, requests: [], unreadRooms: {} };
    const restored = mergeAccountStores(downloaded.store, secondDevice);

    expect(restored.profile).toMatchObject({ id: "ana", connectionCode: "ANA123", displayName: "Ana" });
    expect(restored.contacts).toEqual([bia]);
    expect(restored.groups[0]).toMatchObject({ id: "server-1", name: "Resenha" });
    expect(restored.messages["dm:ana:bia"][0]).toMatchObject({ body: "Mensagem protegida", attachment: { name: "foto.png" } });
    expect(restored.requests[0].id).toBe("request-1");
    expect(restored.unreadRooms?.["dm:ana:bia"].count).toBe(1);
  });

  it("prioriza a foto, o código e o servidor do Drive ao restaurar uma conta", () => {
    const remoteProfile = { id: "ana", connectionCode: "ANA123", displayName: "Ana", bio: "", avatarUrl: "data:image/png;base64,remota" };
    const localProfile = { ...remoteProfile, connectionCode: "LOCAL1", avatarUrl: null };
    const remote = { profile: remoteProfile, contacts: [], requests: [], groups: [{ id: "server", name: "Servidor remoto", imageUrl: null, ownerId: "ana", members: [remoteProfile], channels: [] }], messages: {} };
    const local = { profile: localProfile, contacts: [], requests: [], groups: [{ id: "server", name: "Servidor local", imageUrl: null, ownerId: "ana", members: [localProfile], channels: [] }], messages: {} };
    const restored = restoreAccountStore(remote, local);

    expect(restored.profile).toMatchObject({ connectionCode: "ANA123", avatarUrl: "data:image/png;base64,remota" });
    expect(restored.groups[0].name).toBe("Servidor remoto");
  });
});
