import type { Place, Step, Contact, Profile } from "./types";
import type { Issue } from "./story";
import type { Ctx, Built } from "./story";
import { eachNestedStep } from "./step-utils";

function report(ctx: Ctx, where: string, level: Issue["level"], message: string): void {
  ctx.issues.push({ file: ctx.file, where, level, message });
}

export function validateStoryReferences(
  built: Map<string, Built>,
  places: Map<string, Place>,
  ids: Set<string>,
  assets: Set<string>,
  sounds: Set<string>,
  soundFiles: Set<string>,
  issues: Issue[],
): void {
  const refs = new Map<string, { milestones: Set<string>; writes: Set<string>; reads: { key: string; file: string; onlyWhenPresent: boolean }[]; milestoneReads: { id: string; file: string }[] }>();
  const entry = (scope: string) => {
    let value = refs.get(scope);
    if (!value) {
      value = { milestones: new Set(), writes: new Set(), reads: [], milestoneReads: [] };
      refs.set(scope, value);
    }
    return value;
  };

  const visit = (steps: Step[], scope: string, file: string, depth: number): void => {
    if (depth > 16) return;
    for (const step of steps) {
      const own = entry(scope);
      if (step.t === "milestone") {
        own.milestones.add(step.id);
        own.writes.add(`_m:${step.id}`);
      } else if (step.t === "ask") {
        own.writes.add(step.key);
      } else if (step.t === "quiz") {
        own.writes.add(`_q:${step.id}`);
      } else if (step.t === "set") {
        entry(step.chat ?? scope).writes.add(step.key);
      } else if (step.t === "if" && (step.is !== undefined || step.any !== undefined)) {
        own.reads.push({ key: step.key, file, onlyWhenPresent: true });
      }

      if (step.t === "choice") {
        for (const option of step.opts) {
          if (option.requires?.milestone) {
            entry(option.requires.chat ?? scope).milestoneReads.push({ id: option.requires.milestone, file });
          }
          if (option.requires?.state) {
            const condition = option.requires.state;
            entry(scope).reads.push({
              key: condition.key,
              file,
              onlyWhenPresent: condition.is !== undefined,
            });
          }
          visit(option.then, scope, file, depth + 1);
        }
      } else if (step.t === "if") {
        visit(step.then, scope, file, depth + 1);
      } else if (step.t === "gate") {
        visit(step.then, scope, file, depth + 1);
        if (step.otherwise) visit(step.otherwise, scope, file, depth + 1);
      } else if (step.t === "quiz") {
        visit(step.pass, scope, file, depth + 1);
      } else if (step.t === "append") {
        visit(step.steps, step.chat, file, depth + 1);
      }
    }
  };

  for (const [id, item] of built) {
    for (const chapter of item.chapters) visit(chapter.steps, id, chapter.file, 0);
    const endings = new Set<string>();
    eachNestedStep(item.contact.script, (step: Step) => {
      if (step.t === "ending") endings.add(step.kind);
    });
    if (item.contact.script.length > 0 && endings.size === 0) {
      report(
        { file: item.profileFile, issues, ids, assets, sounds, soundFiles },
        "chat",
        "warning",
        `no route contains a chapter-end, story-end or continue-elsewhere marker`,
      );
    }
  }

  for (const [placeId, place] of places) {
    for (const chat of place.chats) visit(chat.script, `${placeId}/${chat.id}`, `${placeId}.json`, 0);
  }

  for (const [scope, refsForScope] of refs) {
    const ctx: Ctx = { file: scope, issues, ids, assets, sounds, soundFiles };
    for (const read of refsForScope.reads) {
      if (read.onlyWhenPresent && !refsForScope.writes.has(read.key)) {
        report(
          { ...ctx, file: read.file },
          "story references",
          "warning",
          `condition checks "${read.key}", but this chat never remembers or asks for that value`,
        );
      }
    }
    for (const read of refsForScope.milestoneReads) {
      if (!refsForScope.milestones.has(read.id)) {
        report(
          { ...ctx, file: read.file },
          "story references",
          "warning",
          `no milestone "${read.id}" is declared in "${scope}" — this reply may stay locked`,
        );
      }
    }
  }
}