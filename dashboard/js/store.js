// Tiny persistence layer over localStorage.
// Every module keeps its data under its own key, so modules never
// step on each other and can be added/removed freely.

const PREFIX = "dashboard.";

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}
