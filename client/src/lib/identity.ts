export type LocalIdentity = {
  profileId: string;
  deviceToken: string;
};

const IDENTITY_KEY = "orbit-chat.identity.v1";

export function readIdentity(): LocalIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LocalIdentity>;
    return typeof value.profileId === "string" && typeof value.deviceToken === "string"
      ? { profileId: value.profileId, deviceToken: value.deviceToken }
      : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: LocalIdentity) {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

export function clearIdentity() {
  localStorage.removeItem(IDENTITY_KEY);
}

