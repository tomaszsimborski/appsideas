/*
 * Przechowywanie danych w przeglądarce (IndexedDB): utwory, pozycje w
 * folderach i same pliki audio/wideo. Nic nie wychodzi poza to urządzenie.
 */
(function (root) {
  'use strict';

  const DB_NAME = 'warsztat-utworow';
  const VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      const r = fn(s);
      if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  const Store = {
    all: (store) => tx(store, 'readonly', (s) => s.getAll()),
    put: (store, obj) => tx(store, 'readwrite', (s) => s.put(obj)),
    del: (store, id) => tx(store, 'readwrite', (s) => s.delete(id)),
    getBlob: (id) => tx('blobs', 'readonly', (s) => s.get(id)),
    putBlob: (id, blob) => tx('blobs', 'readwrite', (s) => s.put(blob, id)),
    delBlob: (id) => tx('blobs', 'readwrite', (s) => s.delete(id)),
    persist() {
      // Prośba, żeby przeglądarka nie czyściła danych przy braku miejsca.
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    },
    estimate() {
      return navigator.storage && navigator.storage.estimate
        ? navigator.storage.estimate().catch(() => null)
        : Promise.resolve(null);
    },
  };

  root.Store = Store;
})(window);
