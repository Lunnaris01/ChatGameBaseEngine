import type { CharacterType, PlayerCharacter, PlayerInventory } from "./types";
import { mainStatForType } from "./types";

export function createPlayerCharacter(name: string, type: CharacterType, rank = "None"): PlayerCharacter {
  const mainstat = mainStatForType(type);
  const combat = { health: 50, defense: 0, strength: 0, agility: 0, intelligence: 0, cunning: 0 };
  const inventory: PlayerInventory = { gold: 0, potions: 0 };
  if (type === "Fighter") {
    inventory.leftHand = { name: "Sword", attack: 3 };
    inventory.rightHand = { name: "Shield", defense: 2 };
  } else if (type === "Assassin") {
    inventory.leftHand = { name: "Dagger", attack: 2 };
    inventory.rightHand = { name: "Dagger", attack: 2 };
  } else if (type === "Archer") {
    inventory.leftHand = { name: "Bow", attack: 3 };
    inventory.rightHand = { name: "Quiver", attack: 1 };
  } else {
    inventory.leftHand = { name: "Wizard Staff", attack: 3 };
    inventory.rightHand = { name: "Magic Ring", attack: 1 };
  }
  inventory.upperArmor = { name: "Leather Armor", defense: 1 };
  inventory.lowerArmor = { name: "Leather Leggings", defense: 1 };
  inventory.boots = { name: "Leather Boots", defense: 1 };
  return { name, rank, type, mainstat, combat, inventory };
}

export function loadPlayerCharacter(storage: { getItem(key: string): string | null }): PlayerCharacter | null {
  try {
    const raw = storage.getItem("sr-player");
    if (!raw) return null;
    return JSON.parse(raw) as PlayerCharacter;
  } catch {
    return null;
  }
}

export function savePlayerCharacter(storage: { setItem(key: string, value: string): void }, pc: PlayerCharacter): void {
  try { storage.setItem("sr-player", JSON.stringify(pc)); } catch { /* ignore */ }
}
