export type DesktopMediaPreferences = {
  audioInputId: string;
  videoInputId: string;
  audioOutputId: string;
};

const STORAGE_KEY = "resenha-chat.desktop-media-preferences.v1";
const EMPTY_PREFERENCES: DesktopMediaPreferences = { audioInputId: "", videoInputId: "", audioOutputId: "" };

export function readDesktopMediaPreferences(storage: Storage = localStorage): DesktopMediaPreferences {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || "{}") as Partial<DesktopMediaPreferences>;
    return {
      audioInputId: typeof saved.audioInputId === "string" ? saved.audioInputId : "",
      videoInputId: typeof saved.videoInputId === "string" ? saved.videoInputId : "",
      audioOutputId: typeof saved.audioOutputId === "string" ? saved.audioOutputId : "",
    };
  } catch {
    return { ...EMPTY_PREFERENCES };
  }
}

export function saveDesktopMediaPreferences(preferences: DesktopMediaPreferences, storage: Storage = localStorage) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { /* A chamada continua funcional sem salvar a escolha. */ }
  return preferences;
}

export function isDesktopDevice() {
  return typeof navigator !== "undefined" && !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}
