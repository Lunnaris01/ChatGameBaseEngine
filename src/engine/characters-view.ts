import type { Contact, Profile } from "./types";
import type { PlayerCharacter } from "./types";

export type CharactersViewContext = {
  grid: HTMLElement;
  playerCharacter: PlayerCharacter | null;
  contacts: Record<string, Contact>;
  order: string[];
  profiles: Record<string, Profile>;
  devMode: boolean;
  openProfile: (c: Contact) => void;
  openPlayerProfile: () => void;
  esc: (s: string) => string;
};

export function renderCharactersView(ctx: CharactersViewContext): void {
  const { grid, playerCharacter, contacts, order, profiles, devMode, openProfile, openPlayerProfile, esc } = ctx;
  grid.innerHTML = "";
  if (playerCharacter) {
    const pc = playerCharacter;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rounded-2xl bg-chat-800 p-4 text-left";
    b.setAttribute("aria-label", "Open your profile");
    b.innerHTML =
      `<span class="block font-bold">${esc(pc.name)} (You)</span>` +
      `<span class="block text-xs text-ink-300">${esc(pc.type)} · Rank ${esc(pc.rank)}</span>` +
      `<span class="mt-1 block text-xs text-ink-300">Health ${pc.combat.health}</span>`;
    b.addEventListener("click", () => openPlayerProfile());
    grid.appendChild(b);
  }
  let shown = 0;
  for (const id of order) {
    const c = contacts[id];
    if (!c) continue;
    if (c.dev && !devMode) continue;
    if (!c.data.unlocked) continue;
    const prof = profiles[id];
    if (!prof) continue;
    shown++;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rounded-2xl bg-chat-800 p-4 text-left";
    b.setAttribute("aria-label", `Open profile of ${c.data.name}`);
    b.innerHTML =
      `<span class="mt-2 block font-bold">${esc(c.data.name)}</span>` +
      `<span class="block text-xs text-ink-300">${esc(prof.tagline.split(".")[0])}.</span>`;
    b.addEventListener("click", () => openProfile(c));
    grid.appendChild(b);
  }
  if (shown === 0 && !playerCharacter) {
    grid.innerHTML = `<p class="col-span-2 rounded-2xl bg-chat-800 p-6 text-center text-sm text-ink-300">No characters yet — add a file to src/story/characters/ 👥</p>`;
  }
}