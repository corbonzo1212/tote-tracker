// db.js — thin IndexedDB wrapper. No external dependencies.
const DB_NAME = "tote-tracker";
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains("totes")) {
        const totes = db.createObjectStore("totes", { keyPath: "id" });
        totes.createIndex("label", "label", { unique: false });
      }

      if (!db.objectStoreNames.contains("items")) {
        const items = db.createObjectStore("items", { keyPath: "id" });
        items.createIndex("toteId", "toteId", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const DB = {
  uid,

  // ---- Totes ----
  async getAllTotes() {
    const store = await tx("totes", "readonly");
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },

  async getTote(id) {
    const store = await tx("totes", "readonly");
    return reqToPromise(store.get(id));
  },

  async saveTote(tote) {
    const store = await tx("totes", "readwrite");
    await reqToPromise(store.put(tote));
    return tote;
  },

  async deleteTote(id) {
    const totesStore = await tx("totes", "readwrite");
    await reqToPromise(totesStore.delete(id));
    // Cascade delete items in this tote
    const items = await DB.getItemsForTote(id);
    const itemsStore = await tx("items", "readwrite");
    await Promise.all(items.map((it) => reqToPromise(itemsStore.delete(it.id))));
  },

  // ---- Items ----
  async getAllItems() {
    const store = await tx("items", "readonly");
    return reqToPromise(store.getAll());
  },

  async getItemsForTote(toteId) {
    const store = await tx("items", "readonly");
    const idx = store.index("toteId");
    return reqToPromise(idx.getAll(toteId));
  },

  async getItem(id) {
    const store = await tx("items", "readonly");
    return reqToPromise(store.get(id));
  },

  async saveItem(item) {
    const store = await tx("items", "readwrite");
    await reqToPromise(store.put(item));
    return item;
  },

  async deleteItem(id) {
    const store = await tx("items", "readwrite");
    return reqToPromise(store.delete(id));
  },
};
