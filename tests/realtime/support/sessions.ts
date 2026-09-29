import type {
  SessionCredentials,
  TrustedSessionContext,
  TrustedSessionResolver,
} from "@chess-one/edge";

/**
 * TEST-ONLY resolver: bearer tokens mapped to fixed sessions. It declares
 * `test_only`, so a production edge refuses to start with it.
 */
export class TestTrustedSessionResolver implements TrustedSessionResolver {
  readonly trust = "test_only";
  readonly #sessions: Map<string, TrustedSessionContext>;
  /** Every credential pair seen, so tests can prove what reached the resolver. */
  readonly seen: SessionCredentials[] = [];

  constructor(sessions: Readonly<Record<string, TrustedSessionContext>>) {
    this.#sessions = new Map(Object.entries(sessions));
  }

  async resolve(credentials: SessionCredentials): Promise<TrustedSessionContext | null> {
    this.seen.push(credentials);
    const header = credentials.authorization;
    if (header === null || !header.startsWith("Bearer ")) return null;
    return this.#sessions.get(header.slice("Bearer ".length)) ?? null;
  }
}
