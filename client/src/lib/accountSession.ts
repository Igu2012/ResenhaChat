export type OfficialLogin = { uid: string; username?: string; displayName?: string; idToken?: string; refreshToken?: string };

type LoginResponse = { ok: boolean; json: () => Promise<{ account?: OfficialLogin; message?: string }> };

export async function loginOfficialAccount(endpoint: string, username: string, password: string, request: (input: string, init: RequestInit) => Promise<LoginResponse> = fetch) {
  let response: LoginResponse;
  try {
    response = await request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  } catch {
    throw new Error("Não foi possível alcançar o servidor da Resenha. Verifique sua internet e tente novamente.");
  }
  const result = await response.json();
  if (!response.ok || !result.account) throw new Error(result.message || "Não foi possível entrar nesta conta.");
  return result.account;
}

export async function registerOfficialAccount(endpoint: string, username: string, password: string, displayName: string, request: (input: string, init: RequestInit) => Promise<LoginResponse> = fetch) {
  let response: LoginResponse;
  try {
    response = await request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password, displayName }) });
  } catch {
    throw new Error("Não foi possível alcançar o servidor da Resenha. Verifique sua internet e tente novamente.");
  }
  const result = await response.json();
  if (!response.ok || !result.account) throw new Error(result.message || "Não foi possível criar a conta oficial.");
  return result.account;
}

export async function refreshOfficialAccount(endpoint: string, refreshToken: string, request: (input: string, init: RequestInit) => Promise<LoginResponse> = fetch) {
  let response: LoginResponse;
  try {
    response = await request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken }) });
  } catch {
    throw new Error("Não foi possível renovar a sessão agora.");
  }
  const result = await response.json();
  if (!response.ok || !result.account) throw new Error(result.message || "Não foi possível renovar a sessão.");
  return result.account;
}
