// Node 25+ has a broken localStorage global when --localstorage-file has no valid path.
// Replace it entirely with a Map-backed implementation.
;(function() {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      const store = new Map()
      const impl = {
        getItem(key) { return store.get(String(key)) ?? null },
        setItem(key, val) { store.set(String(key), String(val)) },
        removeItem(key) { store.delete(String(key)) },
        clear() { store.clear() },
        key(i) { return [...store.keys()][i] ?? null },
        get length() { return store.size },
      }
      try {
        globalThis.localStorage = impl
      } catch {
        Object.defineProperty(globalThis, 'localStorage', {
          value: impl,
          writable: true,
          configurable: true,
        })
      }
    }
  } catch {}
})()
