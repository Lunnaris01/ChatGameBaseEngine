import { describe, expect, test } from "bun:test";
import { playerHit, enemyHit, healAmount, critChance, strengthBlockChance, intelligenceDodgeChance } from "../src/engine/combat";
import type { PlayerCharacter } from "../src/engine/types";
import type { Enemy } from "../src/engine/types";

const player: PlayerCharacter = {
  name: "Hero",
  rank: "None",
  type: "Fighter",
  mainstat: "strength",
  combat: { health: 50, defense: 0, strength: 10, agility: 0, intelligence: 10, cunning: 0 },
  inventory: { leftHand: { name: "Sword", attack: 3 }, gold: 0, potions: 0 },
};

const enemy: Enemy = { id: "g", name: "Goblin", health: 20, defense: 2, attack: 5, mainstat: 2 };

describe("combat math", () => {
  test("crit chance scales and caps", () => {
    expect(critChance(0)).toBe(0);
    expect(critChance(100)).toBe(20);
  });

  test("block and dodge chances scale and cap", () => {
    expect(strengthBlockChance(0)).toBe(0);
    expect(strengthBlockChance(100)).toBe(10);
    expect(intelligenceDodgeChance(100)).toBe(10);
  });

  test("heal amount is 10% rounded up", () => {
    expect(healAmount(50)).toBe(5);
    expect(healAmount(51)).toBe(6);
  });

  test("player hit never below 1 when raw damage exceeds defense", () => {
    const rng = () => 0; // roll 0
    const hit = playerHit(player, enemy, rng);
    expect(hit.final).toBeGreaterThanOrEqual(1);
  });

  test("enemy hit both block and dodge reduces damage to 0", () => {
    const rng = () => 0.99; // high rolls for block/dodge? chances small but 0.99*100=99 not < 10, so no. Use deterministic by monkey? Instead just shape.
    const hit = enemyHit(enemy, player, () => 0);
    // with rng 0, rolled 0, block/dodge true (0 < chance)
    expect(hit.blocked).toBe(true);
    expect(hit.dodged).toBe(true);
    expect(hit.final).toBe(0);
  });
});

describe("combat edge cases", () => {
  test("player hit final is 0 when raw damage is 0", () => {
    const p: PlayerCharacter = {
      name: "Hero", rank: "None", type: "Fighter", mainstat: "strength",
      combat: { health: 50, defense: 0, strength: 0, agility: 0, intelligence: 0, cunning: 0 },
      inventory: { gold: 0, potions: 0 },
    };
    const e: Enemy = { id: "g", name: "Goblin", health: 20, defense: 100, attack: 0, mainstat: 0 };
    const hit = playerHit(p, e, () => 0);
    expect(hit.final).toBe(0);
  });

  test("enemy hit final never below 1 when raw damage exceeds defense (non-both)", () => {
    const p: PlayerCharacter = {
      name: "Hero", rank: "None", type: "Fighter", mainstat: "strength",
      combat: { health: 50, defense: 0, strength: 0, agility: 0, intelligence: 0, cunning: 0 },
      inventory: { gold: 0, potions: 0 },
    };
    const e: Enemy = { id: "g", name: "Goblin", health: 20, defense: 0, attack: 5, mainstat: 2 };
    const hit = enemyHit(e, p, () => 0.5);
    if (!hit.both && hit.raw > 0) expect(hit.final).toBeGreaterThanOrEqual(1);
  });
});
