import type { Place } from "./types";

export type PlacesViewContext = {
  placeList: HTMLElement;
  placesStatus: HTMLElement;
  placeOrder: string[];
  places: Record<string, Place>;
  devMode: boolean;
  sceneVisited: (chat: Place["chats"][number]) => boolean;
  enterPlace: (place: Place, chat: Place["chats"][number]) => void;
  esc: (s: string) => string;
  tr: (key: any, params?: any) => string;
  issuesLength: number;
};

export function renderPlacesView(ctx: PlacesViewContext): void {
  const { placeList, placesStatus, placeOrder, places, devMode, sceneVisited, enterPlace, esc, tr, issuesLength } = ctx;
  placeList.innerHTML = "";
  placesStatus.textContent = "";
  let shown = 0;
  for (const placeId of placeOrder) {
    const place = places[placeId];
    if (!place) continue;
    if (place.dev && !devMode) continue;
    const chats = place.chats.filter((chat) => chat.data.unlocked);
    if (chats.length === 0) continue;
    shown++;

    const section = document.createElement("section");
    section.className = "space-y-1";
    const heading = document.createElement("div");
    heading.className = "px-2 pt-1";
    heading.innerHTML =
      `<h2 class="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-tick-400"><span aria-hidden="true" class="text-lg">${esc(place.icon)}</span>${esc(place.name)}</h2>` +
      (place.teaser ? `<p class="mt-1 text-xs text-ink-300">${esc(place.teaser)}</p>` : "");
    section.appendChild(heading);

    for (const chat of chats) {
      const done = chat.data.done;
      const fresh = chat.data.transcript.length === 0;
      const row = document.createElement("button");
      row.type = "button";
      row.disabled = false;
      row.className = "flex w-full items-start gap-3 rounded-2xl p-3 text-left hover:bg-chat-800 disabled:cursor-not-allowed disabled:opacity-60" + (done ? " opacity-70" : "");
      row.setAttribute("aria-label", `Open ${chat.title}${done ? " (already read)" : ""}`);
      row.innerHTML =
        `<span aria-hidden="true" class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${done ? "bg-chat-700 text-tick-400" : "bg-chat-800 text-lg"}">${done ? "✓" : esc(place.icon)}</span>` +
        `<span class="min-w-0 flex-1"><span class="flex items-baseline justify-between gap-2"><span class="truncate font-semibold ${done ? "text-ink-300" : ""}">${esc(chat.title)}</span>` +
        `${fresh ? `<span class="shrink-0 rounded-full bg-out-600 px-2 py-0.5 text-xs font-bold text-white">${esc(tr("state.new"))}</span>` : ""}</span>` +
        `<span class="mt-0.5 block text-sm text-ink-300">${esc(chat.teaser)}</span>` +
        `</span>`;
      row.addEventListener("click", () => enterPlace(place, chat));
      section.appendChild(row);
    }
    placeList.appendChild(section);
  }
  if (shown === 0 && issuesLength === 0) {
    placeList.innerHTML = `<p class="rounded-2xl bg-chat-800 p-6 text-center text-sm text-ink-300">No places yet — add a file in src/story/locations/ 📍</p>`;
  }
}