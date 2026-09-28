# Phase 1 Implementation Log

**Authority:** `CHESS_ONE_FINAL_PROGRAMMING_SPEC_BILINGUAL_v6_CODE_READY.md` and its normative annexes.
**Currency date:** 2026-09-28.

## Batch 1: controlled foundation bootstrap

### Scope

In scope:

- The pnpm workspace.
- `domain/game-values`.
- `domain/chess-rules`, first slice only: ruleset registry, immutable position, structural FEN, basic consistency, initial position, and the partial mating-possibility detector.
- Test harness, typed fixtures, property tests, and the boundary check.

Out of scope and not started:

- Move generation and legality, check detection in production, SAN, game state, claims, clocks, and results.
- Server, web client, database, contracts package, deployment, and every product feature.

### Environment

| Item | Value | Note |
|---|---|---|
| Node.js | v24.14.1 (local) | Inside the Node 24 LTS family required by DEC-056. The latest 24.x security release on the currency date is 24.21.0, so the local install is behind on patches. Upgrading the system Node was not done, because this batch makes no system-wide changes. `engines.node` is `>=24.11.0 <25.0.0` |
| pnpm | 12.6.0 | Pinned through `packageManager` and `engines`. Run with `npx --yes pnpm@12.6.0 <command>`. No global install, and corepack was not enabled |
| Registry resolution | 2026-09-28 | Stable dist-tags only. No beta, RC, canary, or nightly anywhere in the lockfile |

### Direct dependencies

All are root `devDependencies`, pinned exactly. No package has production `dependencies` except `@chess-one/chess-rules` → `@chess-one/game-values` (workspace).

| Package | Version | License | Why it exists |
|---|---|---|---|
| typescript | 7.0.2 | Apache-2.0 | Type checking (DEC-056). Native `tsc`, used with `noEmit` |
| @biomejs/biome | 2.5.14 | MIT OR Apache-2.0 | Lint, import order, and format check (DEC-056) |
| vitest | 5.0.2 | MIT | Test runner (DEC-056) |
| fast-check | 4.10.2 | MIT | Property tests for the square and move-intent parsers (DEC-056) |
| @types/node | 24.19.0 | MIT | Node types for tests and tooling only. Domain tsconfigs use `types: []`, so domain code cannot see Node APIs. Vitest 5 lists it as a peer |

Notable transitive packages:

- `vite` 8.3.1 (MIT) and `rolldown` 1.2.11 (MIT), pulled in by Vitest.
- `pure-rand` 8.4.2 (MIT), pulled in by fast-check.
- `lightningcss` 1.33.0 (**MPL-2.0**), a dev-only dependency pulled in by Vite. It is never bundled into product code. It is recorded for the license gate in `ENGINEERING_CONSTITUTION_V1.md`.

Every other transitive license is MIT, ISC, BSD-3-Clause, or Apache-2.0 (`pnpm licenses list`).

### Supply chain

- Lockfile `pnpm-lock.yaml` (lockfileVersion 9.0): 109 packages, including optional platform binaries. 43 were installed on win32-x64. Every package resolves from the npm registry with an integrity hash. There are no git, tarball, or file sources.
- `pnpm audit --json` reached the registry: 0 info, 0 low, 0 moderate, 0 high, 0 critical.
- No `.env` file, secret, credential, or telemetry key exists.

### Files created

| Path | Purpose |
|---|---|
| `package.json` | Workspace root, scripts, engines, exact dev dependencies |
| `pnpm-workspace.yaml` | Workspace packages `domain/*` and `tests/*`; `engineStrict`, `saveExact` |
| `pnpm-lock.yaml` | Generated lockfile |
| `tsconfig.base.json` | Shared strict compiler options |
| `biome.json` | Lint and format rules |
| `vitest.config.ts` | Test projects `rules` and `boundaries` |
| `.gitignore`, `.gitattributes` | Ignore build output and `.env*`; LF line endings |
| `domain/game-values/**` | Value package (see below) |
| `domain/chess-rules/**` | Rules library first slice (see below) |
| `tests/rules/**` | Rules tests, fixtures, test-only support |
| `tests/boundaries/**` | Boundary checker tests and the root script consistency test |
| `tooling/check-boundaries.ts`, `tooling/boundaries/*.ts` | Boundary checker CLI and rules |
| `PHASE_1_IMPLEMENTATION_LOG.md` | This log |

### Source modules

`domain/game-values/src`. No dependencies and no I/O.

- `color.ts`: colors.
- `piece.ts`: piece kinds and frozen pieces.
- `square.ts`: the 64 squares, parsing, and indices.
- `promotion.ts`: q/r/b/n only.
- `move-intent.ts`: structural move request; no auto-queen.
- `ruleset-id.ts`: id text shape only.
- `game-sequence.ts`: branded non-negative safe integer.
- `duration-ms.ts`: branded whole milliseconds.
- `result.ts`: the `Result` type.
- `index.ts`: public entry.

`domain/chess-rules/src`. Depends only on `@chess-one/game-values`.

- `ruleset-registry.ts`: the single `FIDE-E01-2023` text source, metadata, default id, and a resolver that rejects unknown ids.
- `position.ts`: immutable position with 64 cells, side, castling, en passant, and counters.
- `fen.ts`: structural parser and serializer. Checks field count, 8 ranks, 8 files per rank, known symbols, no adjacent digits, exactly one king per color, side, canonical castling syntax, en passant syntax, counters, and a 256-character input cap.
- `position-consistency.ts`: pawns on back ranks, adjacent kings, castling rights against home squares, en passant geometry. This is not legality or reachability (Article 3.10.3).
- `initial-position.ts`: the initial position from the ruleset.
- `mating-possibility.ts`: `PROVEN_DEAD` only for K v K, K+B v K, and K+N v K in either color. Everything else, including K+NN v K, is `UNKNOWN`. It never returns `NOT_DEAD` in this batch because no reviewed `NOT_DEAD` proof is applied. It is not connected to any result (DEC-064).
- `index.ts`: public entry.

### Root scripts

`typecheck`, `lint`, `format:check`, `test`, `test:rules`, `check:boundaries`, and `check`.

- `check` chains every gate with `&&`, so any failing step fails the run. TST-BOUNDARY-014 keeps it in sync with the individual scripts.
- A deliberate `Date.now()` inside `domain/chess-rules/src` was used to confirm that `check` exits with code 1 at the boundary step; the file was then removed.

### Boundary check

`node tooling/check-boundaries.ts` uses no extra dependency. It fails on:

- `game-values` importing anything outside itself.
- `chess-rules` importing anything except the public `@chess-one/game-values` entry.
- Relative imports escaping a domain package.
- Deep imports into `@chess-one/*/…` or `domain/*/src` from outside.
- Test tools or test helpers in production code or in production `dependencies`.
- Future `contracts/` importing server or client code.
- License-gated chess libraries anywhere.
- Import cycles inside domain packages.
- Non-literal dynamic imports in production code.
- Non-TypeScript files in domain source.
- Ambient access in domain code: `process`, `Date.now`, `new Date`, `performance`, `Math.random`, `fetch`, timers, `console`, `globalThis`, `import.meta`, `crypto`, and `Buffer`.

Domain tsconfigs also exclude Node and DOM types, so a `node:fs` import fails typecheck. This was checked.

### Tests

The final run had 11 files: **149 passed, 0 failed, 0 skipped, and 46 todo**. The 46 todo entries are the NOT_IMPLEMENTED ledger rows. They are listed with `it.todo` so they are visible and never counted as passing. No `.skip` is used.

Ledger rows asserted:

| Ledger id | Status | What is asserted |
|---|---|---|
| TST-RULE-E01-014a | PARTIAL | Detector returns `PROVEN_DEAD`. The draw result needs GameResult, which is not in this batch |
| TST-RULE-E01-014b | PARTIAL | Same, both bishop colors |
| TST-RULE-E01-014c | PARTIAL | Same, both knight colors |
| TST-RULE-E01-014d | IMPLEMENTED | K+NN v K is never `PROVEN_DEAD`, both colors |

Fixture integrity was also checked for the rows below. This validates the fixture, not the row's behavior.

- 001, 004, 005, 006, 007, 008a/b, 009, 010, 011a, 012, 013, 014a–d, and 021b. Each FEN is structurally valid and consistent, and the side not to move is not in check. 008a/b additionally check that f1 is attacked, e1/d1/c1 are not attacked, and b1–d1 are empty.
- 018b: replay shows the intended move creates the third occurrence.
- 020b: 99 quiet distinct plies, halfmove 99, and the intended move reaches 100.
- 020c: the intended move is a legal pawn push.

Foundation test ids added in this batch:

| Group | Ids | Covers |
|---|---|---|
| TST-FOUND-SQUARE | 001–005 | Square domain, exact acceptance (property), round trip, `squareAt` totality, move-intent failure without throwing |
| TST-FOUND-VALUES | 001–007 | Colors, pieces, promotion, move intent, sequence, duration, ruleset id syntax |
| TST-FOUND-RULESET | 001–004 | Registry contents, DEC-051 metadata, unknown ids rejected, single text source |
| TST-FOUND-FEN | 001–007 | 31 invalid FENs with exact error codes, golden round trips, deep freeze, castling subsets, structure versus consistency, counters |
| TST-FOUND-INITIAL | 001–002 | Exact placement, White to move, rights, counters |
| TST-FOUND-MATE | 001–002 | Unproven material stays `UNKNOWN`; no result-related export |
| TST-BOUNDARY | 001–014 | Real repository clean, every rule above, script chain |

The test-only `tests/rules/support/attack-oracle.ts` and `knight-replay.ts` validate fixtures. They are not the move engine and are not importable by production code.

### Traceability

| Item | Batch 1 effect |
|---|---|
| DEC-051 | Registry with the single id source |
| DEC-056, DEC-057 | Approved tool families pinned exactly |
| DEC-058 | pnpm workspace, no Nx or Turborepo, boundary check |
| DEC-062, DEC-064 | Partial detector; `UNKNOWN` not mapped to any result |
| DEC-063 | Documentation only. No clock code in this batch |
| FR-P0-017, FR-P06-002, FR-P06-003, FR-P06-004, FR-P06-006, FR-P06-011 | PARTIAL in `TRACEABILITY_MATRIX_V2.md` |
| RULE-014 | Detector half |
| RULE-001 | Initial placement only; move behavior not started |

### Section A preflight (documentation)

- DEC-063: `received_at` stamped in the live-game writer's monotonic domain.
- DEC-064: `UNKNOWN` is `MATING_POSSIBILITY_UNRESOLVED`, never an official result.
- Flag wording in the test architecture now follows the received-at model.
- The technology analysis states the current DEC-056 status.
- Ledger 008a fixed (no black king) and 014d fixed (illegal check).
- Rows 015a and 016b corrected (they used an already finished position).
- New rows 015c, 016e, 018b, 020b, and 020c.
- GAP-MATE-004 recorded (one-sided mating check).
- Details: `PHASE_0_DECISION_CHANGELOG.md` section 12.

### Remaining rule gaps and blockers

- No move generation, legality, check detection, SAN, or perft in production code.
- Consistency does not detect whether the side not to move is in check, and does not compare the halfmove counter with the fullmove number.
- The FEN en passant field is taken as written. Repetition identity (Article 9.2.3) must later use real en passant capture availability, not the raw field.
- GAP-MATE-001 through GAP-MATE-004 are open. The dead-position problem is not solved.
- The local Node patch level is behind 24.21.0.
- Git is not initialized. The owner decides when to initialize it.

### How to run

```text
npx --yes pnpm@12.6.0 install
npx --yes pnpm@12.6.0 run check
```

## Batch 1.1: pre-Batch-2 foundation hardening

Batch 2 is not authorized. This batch adds no rule behavior: no move generation, attack detection, check logic, legality, SAN, perft, clocks, server, UI, database, or API.

### Git

- Local git initialized in `d:\chess-one` on branch `main`. There is no remote; nothing was pushed or published, and git config was not modified.
- `.gitignore` now also ignores `CHESS_ONE_*_REVIEW_BUNDLE.zip`.
- Baseline commit `ff701c2`, "chore: preserve phase 1 batch 1 baseline", holds the reviewed Batch 1 state plus that ignore line. The review ZIP is not tracked.
- Batch 1.1 changes are left uncommitted for review.

### Position invariant

- `Position` is now a class with an ES private field, exported as a type only. The private field makes the type nominal: object literals and spread copies fail typecheck with "Property '#canonical' is missing". There are no casts and no unsafe constructor.
- A `Position` can only come from `parseFen`, `createInitialPosition`, or `createPosition(fields)`. The last one is a public validating factory that returns `Result<Position, PositionInvariantError>`.
- `createPosition` checks:
  - 64 cells;
  - each cell empty or a valid piece, rebuilt with `createPiece`;
  - exactly one king per colour;
  - side to move is white or black;
  - castling is four booleans;
  - en passant is null or on rank 3 or 6;
  - halfmove is a safe integer of at least 0;
  - fullmove is a safe integer of at least 1.

  It copies and freezes the object, the board, and castling. Canonical does not mean legal or reachable (Article 3.10.3).
- `isCanonicalPosition(value)` is the runtime check, done with `#canonical in value`.
- The board type stays a readonly array, not a 64-element tuple. Length 64 is proven at the creation boundary. `pieceAt` throws if a cell is missing instead of reading it as empty. `formatFen` iterates rank slices, so it no longer uses `?? null`.
- `parseFen` keeps the syntax checks. It delegates the king count and counter ranges to `createPosition`, and the error codes are unchanged for every existing invalid-FEN fixture.
- `assessMatingPossibility` accepts only a canonical `Position`. Its king-count branch was removed because the type guarantees it. `PROVEN_DEAD` is not widened, DEC-064 is unchanged, and GAP-MATE-001 through 004 are still open.
- The test helper `tests/rules/support/knight-replay.ts` builds its next state as plain fields and converts them through `createPosition`. No deep import is used and no production type was weakened.

### Boundary checker

Regression tests were written first and run against the old checker:

- 015: `Date["now"]()`, `Math["random"]()`, an aliased `Math`, and `process["env"]`.
- 016: `` `${await import("node:fs")}` ``, `` `${require("node:fs")}` ``, and ``import(`node:fs`)``.
- 017: aliased `require`, `module.require`, an aliased `eval`, and `(0, eval)`.
- 018: `eval`, `new Function`, `Function()`, `(() => 0).constructor(...)`, and `[]["constructor"]["constructor"]`.

The old checker missed 15 of these 16 cases entirely. It reported ``import(`node:fs`)`` only as a non-literal import. Tests 015–018 failed and test 019 (no false positives) passed.

The regex lexer `tooling/boundaries/source-scan.ts` was deleted. `tooling/boundaries/syntax.ts` now parses every source file in one session through the pinned TypeScript 7.0.2 API (`typescript/unstable/sync`) with a virtual file system. It returns AST facts:

- imports;
- non-literal dynamic imports;
- free identifier references;
- member names;
- `import.meta`.

Comments, strings, template text, and regex literals cannot produce facts. `rules.ts` evaluates those facts:

- Any reference to an ambient global is `ambient_access`. That covers `require`, `module`, `exports`, `process`, `globalThis`, `global`, `window`, `self`, `Date`, `performance`, `fetch`, the timers, `queueMicrotask`, `crypto`, `Buffer`, and `console`. Aliases and computed members are covered too.
- `Math` is allowed only as a direct `Math.<name>` read other than `random`.
- `eval`, `Function`, and any `.constructor` or `["constructor"]` read are `dynamic_code`.

After the change all 19 boundary tests pass and the repository scan is clean.

Size. Before: `rules.ts` 286 lines (256 non-blank) and `source-scan.ts` 105 lines (98 non-blank), 391 in total. After: `rules.ts` 320 lines (287 non-blank) and `syntax.ts` 146 lines (134 non-blank), 466 in total.

The growth is mostly the ambient-global list, one name per line, and typed fact interfaces. The removed code was heuristic lexing, such as regex-versus-division guessing and string blanking, which is where the bypasses lived.

Residual limits. This is an architecture guard, not a sandbox. A computed key built at runtime, such as `x["con" + "structor"]`, is not resolved. Domain tsconfigs still exclude Node and DOM types, so `require`, `process`, `Buffer`, and timers also fail typecheck. The API is marked unstable upstream; TypeScript is pinned exactly and the tests would fail on an API break.

### Environment

- ENV-NODE-001 (open): local Node 24.14.1 is below the reviewed Node 24.21.0 LTS baseline. No version manager is installed, and the system Node was not changed.
- Direct dependencies added: 0. `package.json`, the workspace manifests, and `pnpm-lock.yaml` are unchanged. The audit found no known vulnerabilities.

### Tests and gates

- 12 files: 163 passed, 0 failed, 0 skipped, and 46 todo. The todo entries are only the NOT_IMPLEMENTED ledger rows.
- New files: `tests/rules/position.test.ts` (TST-FOUND-POSITION-001–009) and boundary tests TST-BOUNDARY-015–019.
- TST-FOUND-POSITION-009 holds compile-time assertions (`IsAssignable<…, Position>` constants typed `false`), so a structurally forgeable `Position` fails typecheck. It uses no ts-ignore or ts-expect-error. A temporary probe confirmed that literal and spread forgeries, and flipped assertions, are compile errors.
- typecheck, lint (0 warnings), format:check, check:boundaries (43 files), test, and check all pass.
- Three test lines carry `biome-ignore lint/suspicious/noTemplateCurlyInString`, because those strings are source code under test.

### Remaining gaps

- Every Batch 1 rule gap remains: no move generation, legality, check detection, SAN, or perft; GAP-MATE-001 through 004 are open; and consistency does not detect a side not to move being in check.
- ENV-NODE-001 is open until the owner authorizes a Node update.
- The boundary checker depends on an upstream-unstable TypeScript API. Any TypeScript upgrade must re-run TST-BOUNDARY-001–019.
