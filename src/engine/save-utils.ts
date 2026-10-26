export function formatSaveTime(iso: string, lang?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString(lang, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function captureThreads(
  contacts: Record<string, { storeKey: string; data: unknown }>,
  order: string[],
  places: Record<string, { chats: Array<{ storeKey: string; data: unknown }> }>,
  placeOrder: string[],
): Record<string, unknown> {
  const threads: Record<string, unknown> = {};
  for (const id of order) {
    const contact = contacts[id];
    if (!contact) continue;
    threads[contact.storeKey] = structuredClone(contact.data);
  }
  for (const placeId of placeOrder) {
    const place = places[placeId];
    if (!place) continue;
    for (const chat of place.chats) {
      threads[chat.storeKey] = structuredClone(chat.data);
    }
  }
  return threads;
}
