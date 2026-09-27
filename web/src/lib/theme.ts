// Eklavya grounds: ink (default) or paper. Never follows the OS setting.
export type Ground = 'ink' | 'paper'
const KEY = 'soniyo.ground'

export function getGround(): Ground {
  return document.documentElement.dataset.mode === 'paper' ? 'paper' : 'ink'
}

export function setGround(g: Ground): void {
  document.documentElement.dataset.mode = g
  try { localStorage.setItem(KEY, g) } catch { /* per-session only */ }
}
