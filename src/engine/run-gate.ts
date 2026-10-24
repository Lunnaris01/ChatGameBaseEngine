/** Invalidates any async story runner that still holds an older token. */
export class RunGate {
  private generation = 0;

  begin(): number {
    return ++this.generation;
  }

  cancel(): void {
    this.generation++;
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }
}
