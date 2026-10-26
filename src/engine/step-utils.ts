import type { Step } from "./types";

export function eachNestedStep(steps: Step[], visit: (s: Step) => void): void {
  for (const s of steps) {
    visit(s);
    if (s.t === "choice") for (const o of s.opts) eachNestedStep(o.then, visit);
    else if (s.t === "if") eachNestedStep(s.then, visit);
    else if (s.t === "gate") {
      eachNestedStep(s.then, visit);
      if (s.otherwise) eachNestedStep(s.otherwise, visit);
    } else if (s.t === "quiz") eachNestedStep(s.pass, visit);
  }
}