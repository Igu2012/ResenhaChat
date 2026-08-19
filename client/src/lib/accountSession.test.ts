import { describe, expect, it, vi } from "vitest";
import { loginOfficialAccount, refreshOfficialAccount, registerOfficialAccount } from "./accountSession";

describe("reentrada oficial com senha", () => {
  it("envia username e senha ao endpoint de login antes de restaurar a sessão", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ account: { uid: "official", username: "ana", displayName: "Ana", idToken: "temporario" } }) });
    await expect(loginOfficialAccount("/api/account/login", "ana", "senha123", request)).resolves.toMatchObject({ uid: "official", username: "ana" });
    expect(request).toHaveBeenCalledWith("/api/account/login", expect.objectContaining({ method: "POST", body: JSON.stringify({ username: "ana", password: "senha123" }) }));
  });

  it("propaga a falha de senha inválida sem restaurar uma sessão", async () => {
    await expect(loginOfficialAccount("/api/account/login", "ana", "errada123", async () => ({ ok: false, json: async () => ({ message: "Senha inválida." }) }))).rejects.toThrow("Senha inválida.");
  });

	it("encaminha dados de cadastro e expõe orientação de configuração devolvida pelo servidor", async () => {
    const request = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: "Ative Email/Senha em Firebase Authentication > Sign-in method para criar contas oficiais." }) });
    await expect(registerOfficialAccount("/api/account/register", "ana_1", "senha123", "Ana", request)).rejects.toThrow("Ative Email/Senha");
	  expect(request).toHaveBeenCalledWith("/api/account/register", expect.objectContaining({ body: JSON.stringify({ username: "ana_1", password: "senha123", displayName: "Ana" }) }));
	});

	it("envia somente os dados de cadastro, sem confirmação adicional", async () => {
	  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ account: { uid: "official" } }) });
	  await registerOfficialAccount("/api/account/register", "ana_1", "senha123", "Ana", request);
	  expect(request).toHaveBeenCalledWith("/api/account/register", expect.objectContaining({ body: JSON.stringify({ username: "ana_1", password: "senha123", displayName: "Ana" }) }));
	});

  it("converte falhas de transporte em instrução de rede para login e cadastro", async () => {
    const offline = async () => { throw new TypeError("Failed to fetch"); };
    await expect(loginOfficialAccount("https://resenhudochat.onrender.com/api/account/login", "ana", "senha123", offline)).rejects.toThrow("Não foi possível alcançar o servidor da Resenha");
    await expect(registerOfficialAccount("https://resenhudochat.onrender.com/api/account/register", "ana", "senha123", "Ana", offline)).rejects.toThrow("Não foi possível alcançar o servidor da Resenha");
  });

  it("renova silenciosamente uma sessão com o token de renovação", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ account: { uid: "official", idToken: "novo-token", refreshToken: "novo-refresh" } }) });
    await expect(refreshOfficialAccount("/api/account/refresh", "refresh-antigo", request)).resolves.toMatchObject({ uid: "official", idToken: "novo-token" });
    expect(request).toHaveBeenCalledWith("/api/account/refresh", expect.objectContaining({ method: "POST", body: JSON.stringify({ refreshToken: "refresh-antigo" }) }));
  });
});
