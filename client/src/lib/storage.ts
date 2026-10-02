// Browser persistence is optional. Keep current-page preferences when it is blocked.
const memory = new Map<string, string>();
const unsaved = new Set<string>();
export function readLocal(key: string): string | null {
  if (unsaved.has(key)) return memory.get(key) ?? null;
  try { return window.localStorage.getItem(key); }
  catch { return memory.get(key) ?? null; }
}
export function writeLocal(key: string, value: string): boolean {
  memory.set(key, value);
  try { window.localStorage.setItem(key, value); unsaved.delete(key); return true; }
  catch { unsaved.add(key); return false; }
}

// Read persisted state directly when protecting against writes from another tab.
export function readStoredLocal(key: string): string | null {
  try { return window.localStorage.getItem(key); }
  catch { return null; }
}
