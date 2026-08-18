const DATABASE_NAME = "resenha-chat-profile-cache";
const STORE_NAME = "avatars";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveCachedProfileAvatar(profileId: string, avatarUrl: string | null) {
  if (!profileId || !avatarUrl || typeof indexedDB === "undefined") return;
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(avatarUrl, profileId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {
    // A foto continua disponível na sessão atual mesmo se o cache separado falhar.
  }
}

export async function readCachedProfileAvatar(profileId: string): Promise<string | null> {
  if (!profileId || typeof indexedDB === "undefined") return null;
  try {
    const database = await openDatabase();
    const avatar = await new Promise<string | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(profileId);
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return avatar;
  } catch {
    return null;
  }
}

export async function clearCachedProfileAvatars() {
  if (typeof indexedDB === "undefined") return;
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {
    // O reset principal continua válido mesmo se o cache de avatar já não estiver disponível.
  }
}
