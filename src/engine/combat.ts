// Pure helpers for the text-based combat system.
//
// Keeping the math here (instead of inline in app.ts) makes it testable and
// deterministic when a caller supplies its own RNG.

import type { CombatStats, Enemy, PlayerCharacter } from "./types";

export const DICE_BASE = 10;

export function diceMax(mainstat: number): number {
  return DICE_BASE + Math.max(0, mainstat);
}

export function roll(rng: () => number, max: number): number {
  if (max < 0) return 0;
  return Math.floor(rng() * (max + 1));
}

export function critChance(agility: number): number {
  if (agility <= 0) return 0;
  return Math.min(20, Math.floor((agility / 100) * 20) + 1);
}

export function strengthBlockChance(strength: number): number {
  if (strength <= 0) return 0;
  return Math.min(10, Math.floor((strength / 100) * 10) + 1);
}

export function intelligenceDodgeChance(intelligence: number): number {
  if (intelligence <= 0) return 0;
  return Math.min(10, Math.floor((intelligence / 100) * 10) + 1);
}

export function weaponAttack(player: PlayerCharacter): number {
  return (player.inventory.leftHand?.attack ?? 0) + (player.inventory.rightHand?.attack ?? 0);
}

export function armorDefense(player: PlayerCharacter): number {
  return (player.inventory.upperArmor?.defense ?? 0) +
    (player.inventory.lowerArmor?.defense ?? 0) +
    (player.inventory.boots?.defense ?? 0) +
    (player.inventory.leftHand?.defense ?? 0) +
    (player.inventory.rightHand?.defense ?? 0);
}

export type PlayerHit = {
  rolled: number;
  crit: boolean;
  raw: number;
  final: number;
};

export function playerHit(player: PlayerCharacter, enemy: Enemy, rng: () => number): PlayerHit {
  const main = player.combat[player.mainstat] ?? 0;
  const rolled = roll(rng, diceMax(main));
  const crit = rng() * 100 < critChance(player.combat.agility);
  let raw = weaponAttack(player) + rolled;
  if (crit) raw = Math.ceil(raw * 1.5);
  let final = Math.max(0, raw - enemy.defense);
  if (raw > 0 && final > 0) final = Math.max(1, final);
  if (raw === 0) final = 0;
  return { rolled, crit, raw, final };
}

export type EnemyHit = {
  rolled: number;
  raw: number;
  blocked: boolean;
  dodged: boolean;
  both: boolean;
  final: number;
};

export function enemyHit(enemy: Enemy, player: PlayerCharacter, rng: () => number): EnemyHit {
  const main = enemy.mainstat ?? 0;
  const rolled = roll(rng, diceMax(main));
  const rawBase = enemy.attack + rolled;
  const blocked = rng() * 100 < strengthBlockChance(player.combat.strength);
  const dodged = rng() * 100 < intelligenceDodgeChance(player.combat.intelligence);
  const both = blocked && dodged;
  let raw = rawBase;
  if (both) raw = 0;
  else if (blocked || dodged) raw = Math.ceil(raw * 0.5);
  const defense = armorDefense(player);
  let final = Math.max(0, raw - defense);
  if (raw > 0 && final > 0 && !(both)) final = Math.max(1, final);
  if (both) final = 0;
  if (rawBase === 0) final = 0;
  return { rolled, raw: rawBase, blocked, dodged, both, final };
}

export function healAmount(maxHealth: number, percent = 0.1): number {
  return Math.ceil(maxHealth * percent);
}
