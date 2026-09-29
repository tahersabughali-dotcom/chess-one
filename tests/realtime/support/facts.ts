import type { FactSink } from "@chess-one/live-game-runtime";

export class RecordingFacts<F extends { readonly name: string }> implements FactSink<F> {
  readonly facts: F[] = [];

  record(fact: F): void {
    this.facts.push(fact);
  }

  count(name: F["name"]): number {
    return this.facts.filter((fact) => fact.name === name).length;
  }

  named(name: F["name"]): readonly F[] {
    return this.facts.filter((fact) => fact.name === name);
  }
}

/** Collects unexpected exceptions; every test asserts it stays empty unless it expects one. */
export class DefectLog {
  readonly errors: unknown[] = [];

  readonly report = (error: unknown): void => {
    this.errors.push(error);
  };
}
