import type { Enemy, PlayerCharacter } from "./types";
import { RunGate } from "./run-gate";
import { playerHit, enemyHit, healAmount } from "./combat";
import { createRng } from "./rng";
import { requireElement } from "./dom";

export type CombatDeps = {
  ENEMIES: Record<string, Enemy>;
  getPlayer: () => PlayerCharacter | null;
  setPlayer: (pc: PlayerCharacter) => void;
  createPlayer: (name: string, type: PlayerCharacter["type"]) => PlayerCharacter;
  getPlayerName: () => string;
  viewChat: HTMLElement;
  viewCombat: HTMLElement;
  combatEnemyName: HTMLElement;
  combatEnemyDesc: HTMLElement;
  combatEnemyHealth: HTMLElement;
  combatPlayerHealth: HTMLElement;
  combatLog: HTMLElement;
  combatAttack: HTMLButtonElement;
  combatPotion: HTMLButtonElement;
  hideView: (el: HTMLElement) => void;
  hideTabs: () => void;
  runGate: RunGate;
  loadAutosave: () => void;
  restartGame: () => void;
  savePlayer: (pc: PlayerCharacter) => void;
  esc: (s: string) => string;
};

export async function runCombatView(deps: CombatDeps, t: { data: { queue: unknown[] } }, myGen: number, enemyId: string): Promise<void> {
  const enemyDef = (deps.ENEMIES ?? {})[enemyId];
  if (!enemyDef) {
    const p = document.createElement("p");
    p.textContent = `Unknown enemy: ${enemyId}`;
    deps.combatLog.appendChild(p);
    return;
  }
  const player = deps.getPlayer() ?? deps.createPlayer(deps.getPlayerName() || "Hero", "Fighter");
  deps.setPlayer(player);
  let playerHp = player.combat.health;
  let enemyHp = enemyDef.health;

  deps.hideView(deps.viewChat);
  deps.viewCombat.classList.remove("hidden");
  deps.viewCombat.classList.add("flex");
  deps.hideTabs();
  deps.combatEnemyName.textContent = enemyDef.name;
  deps.combatEnemyDesc.textContent = enemyDef.description ?? "";
  deps.combatLog.innerHTML = "";
  (window as unknown as { __combatLog?: string[] }).__combatLog = [];

  const log = (msg: string): void => {
    const p = document.createElement("p");
    p.textContent = msg;
    deps.combatLog.appendChild(p);
    deps.combatLog.scrollTop = deps.combatLog.scrollHeight;
    (window as unknown as { __combatLog?: string[] }).__combatLog?.push(msg);
  };

  const updateHealths = (): void => {
    deps.combatEnemyHealth.textContent = `${enemyDef.name}: ${enemyHp}/${enemyDef.health}`;
    deps.combatPlayerHealth.textContent = `${player.name}: ${playerHp}/${player.combat.health}`;
  };
  updateHealths();

  const rng = createRng(Date.now());

  const waitForButton = (btn: HTMLButtonElement): Promise<void> =>
    new Promise((resolve) => {
      const handler = (): void => {
        btn.removeEventListener("click", handler);
        resolve();
      };
      btn.addEventListener("click", handler);
    });

  const keyHandler = (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      deps.combatAttack.click();
    } else if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      deps.combatPotion.click();
    }
  };
  window.addEventListener("keydown", keyHandler);

  let fighting = true;
  while (fighting && deps.runGate.isCurrent(myGen) && playerHp > 0 && enemyHp > 0) {
    let action: string = "attack";
    const attackPromise = waitForButton(deps.combatAttack).then(() => { action = "attack"; });
    const potionPromise = waitForButton(deps.combatPotion).then(() => { action = "potion"; });
    await Promise.race([attackPromise, potionPromise]);
    if (!deps.runGate.isCurrent(myGen)) return;

    if (action === "potion") {
      if (player.inventory.potions <= 0) {
        log("You have no potions left.");
        continue;
      }
      player.inventory.potions -= 1;
      deps.savePlayer(player);
      const heal = healAmount(player.combat.health);
      playerHp = Math.min(player.combat.health, playerHp + heal);
      log(`You drink a potion and recover ${heal} health.`);
      updateHealths();
    } else {
      const hit = playerHit(player, enemyDef, rng);
      if (hit.crit) log("Critical hit!");
      enemyHp -= hit.final;
      if (enemyHp < 0) enemyHp = 0;
      log(`You hit the ${enemyDef.name} for ${hit.final}.`);
      updateHealths();
      if (enemyHp <= 0) {
        log(`The ${enemyDef.name} is defeated.`);
        fighting = false;
        break;
      }
    }

    if (fighting && enemyHp > 0 && playerHp > 0) {
      const hit = enemyHit(enemyDef, player, rng);
      if (hit.both) log("With superior intelligence you predicted the attack and only get hit slightly. With your superior strength, you hardly felt anything.");
      else if (hit.dodged) log("With superior intelligence you predicted the attack and dodged half the damage.");
      else if (hit.blocked) log("With your superior strength, you blocked half the damage.");
      playerHp -= hit.final;
      if (playerHp < 0) playerHp = 0;
      log(`The ${enemyDef.name} hits you for ${hit.final}.`);
      updateHealths();
      if (playerHp <= 0) {
        log("You have been defeated.");
        fighting = false;
      }
    }
  }

  window.removeEventListener("keydown", keyHandler);
  deps.viewCombat.classList.add("hidden");
  deps.viewCombat.classList.remove("flex");

  if (playerHp <= 0) {
    const decision = await new Promise<"load" | "restart" | "cancel">((resolve) => {
      // We need the dialog; but deps doesn't include it. Use document.
      const dialog = requireElement<HTMLDialogElement>("death-confirm");
      const loadBtn = requireElement<HTMLButtonElement>("death-load");
      const restartBtn = requireElement<HTMLButtonElement>("death-restart");
      const cancelBtn = requireElement<HTMLButtonElement>("death-cancel");
      dialog.showModal();
      loadBtn.focus();
      const onLoad = (): void => { cleanup(); resolve("load"); };
      const onRestart = (): void => { cleanup(); resolve("restart"); };
      const onCancel = (): void => { cleanup(); resolve("cancel"); };
      const cleanup = (): void => {
        loadBtn.removeEventListener("click", onLoad);
        restartBtn.removeEventListener("click", onRestart);
        cancelBtn.removeEventListener("click", onCancel);
        dialog.close();
      };
      loadBtn.addEventListener("click", onLoad);
      restartBtn.addEventListener("click", onRestart);
      cancelBtn.addEventListener("click", onCancel);
    });
    if (decision === "load") deps.loadAutosave();
    else if (decision === "restart") deps.restartGame();
    else {
      deps.viewChat.classList.remove("hidden");
      deps.viewChat.classList.add("flex");
    }
  } else {
    deps.viewChat.classList.remove("hidden");
    deps.viewChat.classList.add("flex");
  }
}
