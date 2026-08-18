import { describe, expect, it } from "vitest";
import { decryptAccountSnapshot, encryptAccountSnapshot, mergeAccountStores } from "./accountDriveSync";

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
});
