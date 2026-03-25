export async function register() {
  if (typeof localStorage !== 'undefined' && typeof localStorage.getItem !== 'function') {
    const store = new Map<string, string>()
    Object.defineProperties(localStorage, {
      getItem: { value: (key: string) => store.get(key) ?? null, configurable: true },
      setItem: { value: (key: string, val: string) => store.set(key, String(val)), configurable: true },
      removeItem: { value: (key: string) => store.delete(key), configurable: true },
      clear: { value: () => store.clear(), configurable: true },
      key: { value: (i: number) => [...store.keys()][i] ?? null, configurable: true },
      length: { get: () => store.size, configurable: true },
    })
  }
}
