/**
 * Tiny key-value store on IndexedDB (room for the offline copies of jobs, lists and the outbox), with localStorage as
 * a fallback where IndexedDB is not available (e.g. some private windows).
 */
const DB_NAME = 'wos-offline';
const STORE = 'kv';
let opening: Promise<IDBDatabase> | null = null;

function open() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest) {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    return await run<T | undefined>('readonly', (s) => s.get(key));
  } catch {
    try {
      const raw = localStorage.getItem(`${DB_NAME}:${key}`);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return undefined;
    }
  }
}

export async function idbSet(key: string, value: unknown) {
  try {
    await run('readwrite', (s) => s.put(value, key));
  } catch {
    try {
      localStorage.setItem(`${DB_NAME}:${key}`, JSON.stringify(value));
    } catch {
      /* storage full or blocked: the app still works, only without the offline copy */
    }
  }
}

export async function idbDel(key: string) {
  try {
    await run('readwrite', (s) => s.delete(key));
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(`${DB_NAME}:${key}`);
  } catch {
    /* ignore */
  }
}
