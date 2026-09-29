export async function fieldDraft(
  key: string,
  value?: any,
  remove = false,
): Promise<any> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("urbana-field", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
        "drafts",
        value !== undefined || remove ? "readwrite" : "readonly",
      ),
      store = tx.objectStore("drafts"),
      request = remove
        ? store.delete(key)
        : value !== undefined
          ? store.put(value, key)
          : store.get(key);
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
