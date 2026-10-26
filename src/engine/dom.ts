export function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export function maybeElement<T extends HTMLElement>(id: string): T | null {
  const el = document.getElementById(id);
  return (el as T | null) ?? null;
}
