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

## Batch 2: standard chess move-legality core

Batch 3 is not authorized. This batch builds no SAN, PGN, GameResult, termination events, clocks, draw claims, repetition, adjudication, server, UI, database, engine search, or bitboards.

### Baseline

- `.gitignore` now ignores `CHESS_ONE_*_REVIEW*.zip`. `git check-ignore` confirmed it covers both review ZIPs.
- `pnpm check` passed before the commit.
- Batch 1.1 was committed locally as `00673df` "chore: harden phase 1 foundation", together with the `.gitignore` change. There is no remote and nothing was pushed. The tree was then clean except for the ignored ZIPs.
- The Batch 2 changes are uncommitted, for review.

### Modules (domain/chess-rules/src)

| File | Responsibility | Exported from the package |
|---|---|---|
| `attacks.ts` | Geometric attack relation, king location, check | `isSquareAttacked`, `isInCheck`, `findKing` |
| `move-generation.ts` | Pseudo-legal generation, castling paths, en passant victim | No, package-internal |
| `move-transition.ts` | The one position transition: board, side, castling rights, en passant target, clocks | No, package-internal |
| `legal-moves.ts` | King-safety filter and the public move API | `generateLegalMoves`, `applyLegalMove`, `LegalMoveError` |
| `position-consistency.ts` | New issue `non_moving_side_in_check` | Unchanged export |

Design notes:

- Attack detection never consults legality, so a pinned piece still attacks and still gives check. Castling is not an attack.
- A move is a `MoveIntent`. The transition derives the special effects from the board:
  - castling is a king moving two files;
  - en passant is a pawn moving diagonally onto an empty square;
  - a double push is a pawn moving two ranks.
- A pseudo-legal move is legal when, after `boardAfterMove`, the mover's king is not attacked. That single test covers pins, discovered attacks, blocks, captures of the checker, king moves, en passant exposure, and double check. There are no hard-coded pin rules.
- Castling additionally requires the king's square, the crossed square, and the destination to be unattacked. The rook's squares and b1/b8 are not checked.
- `applyLegalMove` examines only the candidates from the source square, through the same legality test, so it never regenerates the whole list. Error precedence is:
  - an exact legal match is applied;
  - `promotion_required`;
  - `promotion_unexpected`;
  - `illegal_move`.
- The next position always comes from `createPosition`. A failure there throws as a programming defect.
- Move order is source square index, then destination index, then promotion q, r, b, n. This is engineering behaviour, not a FIDE rule. Lists and moves are frozen.
- Castling rights are only ever cleared: by a king move, or by any move from or to a rook's original square. A rook that returns never restores a right.
- The en passant target is set after every two-square advance, which is the FEN convention, and cleared after any other move.
- The halfmove clock resets after a pawn move or capture and otherwise increments. The fullmove number increments after Black moves.
- `position-consistency.ts` now uses `findKing` instead of its own scan.

### Article mapping

| Articles | Rule | Evidence |
|---|---|---|
| 3.1 | No capture of an own piece; king never captured | TST-RULE-E01-003, TST-FOUND-MOVEPROP-002 |
| 3.2–3.6 | Bishop, rook, queen, knight geometry and blocking | TST-FOUND-ATTACK-002–007, perft |
| 3.7 | Pawn pushes, double push, captures | TST-FOUND-ATTACK-001, TST-RULE-E01-001/002, perft |
| 3.7.3.1 | En passant | TST-RULE-E01-009/010, TST-FOUND-EP-001–003, TST-FOUND-TRANSITION-009 |
| 3.7.3.3 | Promotion, no auto-queen, underpromotion | TST-RULE-E01-011a–d, TST-FOUND-PROMO-001–003, TST-FOUND-TRANSITION-010 |
| 3.8, 3.9 | King moves, adjacency, check, legality | TST-RULE-E01-004/005/006, TST-FOUND-ATTACK-008–011, TST-FOUND-LEGAL-006 |
| 3.8.2 | Castling rights, path, attacked squares | TST-RULE-E01-007/008a/008b, TST-FOUND-CASTLE-001–005, TST-FOUND-TRANSITION-004–008 |
| 3.10.1–3.10.2 | Legal and illegal move definitions | `generateLegalMoves` / `applyLegalMove`, TST-FOUND-LEGAL-001–005 |
| 5.1.1, 5.2.1 (condition only) | No legal move, with or without check | TST-RULE-E01-012/013 |

3.10.3 reachability is not proven; `checkPositionConsistency` remains partial.

### Ledger status changes

- **IMPLEMENTED:** 002, 003, 004, 005, 006, 007, 008a, 010, 011a, 011d. The ledger's IllegalMove and InvalidState are asserted as the domain errors; the contract mapping comes later.
- **PARTIAL:**
  - 001: SAN, game sequence, and terminal status are pending.
  - 008b, 009, 011b, 011c: SAN is pending.
  - 012 and 013: GameResult is pending.
- A new guard test requires every IMPLEMENTED or PARTIAL row to be named by an executable test.

### Tests

New test files:

- `attacks.test.ts`: TST-FOUND-ATTACK-001–013. 012 compares against the independent test oracle on every golden position.
- `legal-moves.test.ts`: the golden rows and TST-FOUND-LEGAL-001–006.
- `special-moves.test.ts`: TST-FOUND-CASTLE, TST-FOUND-EP, TST-FOUND-PROMO.
- `move-transition.test.ts`: TST-FOUND-TRANSITION-001–010.
- `move-properties.property.test.ts`: TST-FOUND-MOVEPROP-001–004, fast-check.
- `perft.test.ts`: TST-FOUND-PERFT.

Test support: `positions.ts`, and `perft.ts` (perft and a divide helper, test-only).

Property tests run bounded playouts of at most 40 plies from five start positions, with 60 runs (30 for the oracle comparison). They check:

- every generated move applies;
- the result is canonical, with one king each and the other side to move;
- the mover is not in check afterwards;
- there are no duplicates and no king captures;
- the documented order holds;
- generation is deterministic;
- FEN round trips;
- production attacks agree with the test oracle.

A mutation check deliberately broke four rules in turn, and each was caught:

| Injected bug | Failing tests |
|---|---|
| Castling crossed-square check removed | 5 |
| En passant victim not removed | 7 |
| Captured corner rook keeps its right | 1 |
| Pawn attack direction flipped | 8 |

### Perft

The vectors come from the Chess Programming Wiki "Perft Results" tables. They are engineering regression oracles, not legal authority. All required depths match, with no special cases:

| Position | Depths and nodes |
|---|---|
| Initial | 1, 20, 400, 8902, 197281 (depths 0–4) |
| Kiwipete | 48, 2039, 97862 (depths 1–3) |
| Position 3 | 14, 191, 2812, 43238 (depths 1–4) |
| Position 4 | 6, 264, 9467 (depths 1–3) |

Measured locally on the 64-cell board, with no timing assertion:

| Run | Time |
|---|---|
| Initial depth 4 | about 2.5 s |
| Kiwipete depth 3 | about 1.1 s |
| Position 3 depth 4 | about 0.6 s |
| Whole rules suite | about 5 s |

No bitboards.

### Gates and supply chain

- 18 test files: 241 passed, 0 failed, 0 skipped, 29 todo. All 29 todo entries are NOT_IMPLEMENTED ledger rows.
- typecheck, lint, format:check, check:boundaries, test, test:rules, and check pass.
- Dependencies added: 0. `package.json` and `pnpm-lock.yaml` are unchanged.
- No casts, ts-ignore, or ts-expect-error. Domain code uses no Date, randomness, I/O, or timers; the boundary checker passes.

### Remaining gaps

- No SAN, PGN, GameResult, checkmate or stalemate termination, draw claims, repetition, 50/75-move rules, or clocks.
- 3.10.3 reachability is not proven.
- The en passant field is still taken as written in FEN. Repetition identity will later need real capture availability.
- Consistency does not check that the en passant target matches a real double push beyond the existing checks.
- GAP-MATE-001 through 004 are open, and dead-position detection is not expanded.
- ENV-NODE-001 is open. Node must be resolved before server or web work.

## Batch 3: canonical SAN and checkmate/stalemate rule facts

Batch 4 is not authorized. This batch builds no SAN parser, PGN, durable GameResult, game events, clocks, draws, repetition, 50/75-move rules, resignation, timeout, dead-position completion, server, UI, or database.

### Baseline

- Before Batch 3, `pnpm check` passed. The 19 working files were byte-identical to the reviewed Batch 2 ZIP.
- The reviewed Batch 2 was committed locally as `86c3ce0` "feat: implement standard chess move legality core". There is no remote and nothing was pushed. `package.json` and `pnpm-lock.yaml` are unchanged, and the review ZIPs stay ignored.
- The Batch 3 changes are uncommitted, for review.

### Modules (domain/chess-rules/src)

| File | Responsibility | Exported from the package |
|---|---|---|
| `terminal.ts` (25 lines) | Move-exhaustion rule fact | `evaluateMoveExhaustion`, `MoveExhaustionFact` |
| `san.ts` (89 lines) | Chess One canonical SAN output | `toCanonicalSan` |
| `legal-moves.ts` | New internal `legalMovesFrom` and `resolveLegalMove`; `applyLegalMove` now delegates to them | Unchanged export |
| `move-generation.ts` | New internal `isCaptureMove`, shared by the transition and SAN | No |

### Move-exhaustion fact (Articles 1.4, 5.1.1, 5.2.1)

- `evaluateMoveExhaustion(position)` returns `null` while the side to move has a legal move.
- With no legal move, it returns a frozen `{ kind: "checkmate", winner, loser }` when that side is in check, otherwise a frozen `{ kind: "stalemate" }`.
- It is a pure chess-rule fact. It is not a durable GameResult, `game.finished.v1`, rating event, or tournament result, and it is not connected to persistence.
- `assessMatingPossibility` stays separate, and DEC-064 still applies: UNKNOWN is never turned into a result. GAP-MATE-001 through 004 remain open.

### Canonical SAN (FIDE Appendix C source vs Chess One serialization)

FIDE Appendix C is the rules source for algebraic notation. Chess One canonical SAN is an engineering contract derived from it. The punctuation choices below are Chess One's; they are not the only notation FIDE allows.

- **Piece letters:** English K, Q, R, B, N. A pawn has no letter.
- **Captures:** always marked with `x`. A pawn capture names only the source file, as in `exd5`.
- **Castling:** `O-O` and `O-O-O`, with capital O.
- **Promotion:** `=Q`, `=R`, `=B`, `=N`, written before any suffix. There is no auto-queen.
- **Suffixes:** `+` when the side to move after the move is in check and has a legal move; `#` when it is in check with none; no suffix otherwise. `++` is never used.
- **En passant:** the plain pawn-capture form, as in `exd6`. FIDE permits an `e.p.` indication, but Chess One stores one stable form without it.
- **Disambiguation:** the rivals are the other pieces of the same kind and colour that can **legally** reach the destination. Use the source file if it is unique, else the source rank, else both. It is general for Q, R, B, N. A pinned piece is never a rival. The king never needs it, because a canonical position has one king per colour. Pawn captures use the file rule instead.
- **Capture detection:** judged on the pre-move board, through the shared `isCaptureMove`. A capture is an occupied destination or an en passant victim, never just a change of file.
- **Legality:** `toCanonicalSan` first resolves the intent through `resolveLegalMove`, the same authority as `applyLegalMove`. An illegal intent returns the same `LegalMoveError`; there is no `invalid_san`.
- **Output only:** SAN is never parsed, and no legality depends on it.

### Ledger status changes

| Row | New status | Evidence |
|---|---|---|
| 008b | IMPLEMENTED | SAN `O-O-O`; e1, d1, and c1 unattacked; b1 empty |
| 009 | IMPLEMENTED | SAN `exd6`; d5 emptied |
| 011c | IMPLEMENTED | SAN `a8=N` |
| 012 | IMPLEMENTED | Checkmate fact, winner white, loser black |
| 013 | IMPLEMENTED | Stalemate fact |
| 001 | PARTIAL | SAN `e4` and not-terminal are asserted; game sequence +1 is game-layer semantics |
| 011b | IMPLEMENTED | SAN `a8=Q#`. In fixture `8/P7/8/8/8/8/8/k1K5 w` the promotion is checkmate. The ledger's old expectation `a8=Q` was corrected to `a8=Q#` after the independent Batch 3 review confirmed it. The fixture, the move, and the SAN rules are unchanged |

The ledger-status header now states that "Terminal ... checkmate/stalemate" is asserted as the pure rule fact, and that durable GameResult is later platform work. Rows 014a–c are unchanged.

### Tests

- `san.test.ts`: TST-FOUND-SAN-001–014.
  - Quiet moves, captures, castling, promotions, check, mate, and en passant.
  - Disambiguation by file, by rank, by both, with a capture, and with a pinned rival.
  - Illegal intents return the `applyLegalMove` error, and SAN derivation causes no mutation.
  - Every fixture must pass `checkPositionConsistency`, and its legal move set is asserted before its SAN.
- `terminal.test.ts`: TST-FOUND-TERMINAL-001–006.
  - Three checkmates, including one where Black wins, and three stalemates.
  - Brute force over every from/to/promotion intent confirms that nothing is accepted in terminal positions.
  - Check is confirmed by the independent test attack oracle.
  - Positions with a legal move, even in check, have no fact, and bare kings are not move exhaustion.
- `san-properties.property.test.ts`: TST-FOUND-SANPROP-001–003.
  - For every legal move in seven selected positions (initial, Kiwipete, Position 4, a promotion position, en passant, and two check-heavy positions):
    - SAN succeeds and `applyLegalMove` accepts the move;
    - the suffix agrees with the oracle's checkers and the next position's move count;
    - `x` appears exactly on captures and `=` exactly on promotions;
    - the SAN has a valid shape and is unique within the position.
  - SAN uniqueness over bounded playouts: 40 runs, up to 30 plies.
  - Move-exhaustion facts agree with the oracle over 200 playouts from near-terminal starts, with coverage of checkmate, stalemate, and ongoing positions asserted.
- `support/playouts.ts` now holds the shared playout generator, which `move-properties.property.test.ts` also uses.

A mutation check deliberately broke four things in turn, and each was caught:

| Injected bug | Failing tests |
|---|---|
| Pseudo-legal rivals | 1 (SAN-012) |
| Mate labelled `+` | 3 |
| En passant not treated as a capture | 3 |
| Rank tried before file | 2 |

### Perft and performance

- Every Batch 2 perft vector still matches, and none was changed.
- SANPROP-001 derives SAN for about 200 moves in about 33 ms, roughly 0.15 ms per move.
- One SAN call:
  1. resolves the move through the legality authority;
  2. looks for legal rivals only among same-kind pieces;
  3. applies the move once;
  4. inspects the next position's legal moves only when the move gives check.
- No caches, memoization, or bitboards.

### Gates and supply chain

- 21 test files: 264 passed, 0 failed, 0 skipped, 29 todo. The todo entries are the NOT_IMPLEMENTED ledger rows; the rows moved were PARTIAL, so the todo count did not change.
- Dependencies added: 0. `package.json` and `pnpm-lock.yaml` are unchanged.
- No casts, ts-ignore, or ts-expect-error. The boundary rules are unchanged and pass.

### Self-review

- **Is SAN ever trusted as input?** No. No parser exists.
- **Can an illegal move receive SAN?** No. SAN-013 and the brute-force check in TERMINAL-003 show this.
- **Can a pinned piece force disambiguation?** No. SAN-012 tests it.
- **Is en passant counted as a capture?** Yes, through the shared helper.
- **Do pawn captures name the source file?** Yes.
- **Does the promotion letter come before `+` or `#`?** Yes.
- **Is castling notation stable?** Yes, `O-O` and `O-O-O`.
- **Can two legal moves share SAN?** No. SANPROP-001 and 002 check this.
- **Can a mate be labelled `+`, or a stalemate called checkmate?** No. These are checked against the oracle.
- **Did notation duplicate legality logic?** No. SAN uses `resolveLegalMove` and `legalMovesFrom`.
- **Does SAN mutate anything?** No. SAN-014 checks this.
- **Did any perft value change?** No.
- **Was GameResult or persistence introduced?** No.

### Remaining gaps

- No durable GameResult or game events; no draws, repetition, or 50/75-move rules; no resignation, timeout, or clocks; no PGN.
- Dead-position detection is still partial (GAP-MATE-001 to 004), and 3.10.3 reachability is not proven.
- ENV-NODE-001 is open.

## Batch 4: repetition identity, draw claims, fivefold, and 50/75-move rules

Batch 5 is not authorized. This batch builds no ClaimDrawCommand processing, clock, GameResult, `game.finished.v1`, draw agreement, resignation, timeout, server, UI, or database.

### Baseline

- **011b correction:** the independent Batch 3 review confirmed the TST-RULE-E01-011b correction. The ledger's expected SAN changed from `a8=Q` to `a8=Q#`, because the resulting position is checkmate.
  - The fixture, the move, and the SAN rules are unchanged.
  - 011b is now IMPLEMENTED, and the owner-decision note was removed.
- `pnpm check` passed. Batch 3 and the correction were committed locally as `bcc0def` "feat: add canonical SAN and terminal rule facts". There is no remote and nothing was pushed.
- The Batch 4 changes are uncommitted, for review.

### Modules (domain/chess-rules/src)

| File | Responsibility | Exports |
|---|---|---|
| `repetition.ts` (124 lines) | Article 9.2.3 identity and occurrence counting | `repetitionKey`, `RepetitionKey`, `samePositionForRepetition`, `repetitionCount`, `RuleHistoryError` |
| `draw-rules.ts` (174 lines) | Claim assessment and automatic draw facts | `evaluateDrawClaim`, `evaluateAutomaticDraws`, `INCORRECT_CLAIM_BONUS_MS`, and the output types |

### Repetition identity (Article 9.2.3)

- `RepetitionKey` is an opaque, frozen class. It has a private constructor, so the only way to obtain one is `repetitionKey(position)`; a client string cannot become a key.
- Its `text` is inspectable, unambiguous, space-delimited canonical text, so it is collision-free by construction:
  - 64 board characters from a1 to h8;
  - `w` or `b` for the side to move;
  - four castling slots in the order `KQkq`, with `-` for a missing right;
  - the effective en passant square (two characters), or `-`.
- No SAN, FEN clocks, or hash are involved.
- **En passant:** the target counts only if an actual legal en passant capture is available to the side to move. That is decided by the existing legal-move authority, `generateLegalMoves`, together with the existing `enPassantVictim` helper, so no new movement logic was added (corrected in Batch 4.1, below).
  - A target that no pawn can reach does not count.
  - A capture that is illegal because it would expose the king does not count.
  - A king standing next to the target does not count.
  - A normal pawn capture onto an occupied target square does not count.
- **Castling:** the rights come from the canonical position, which legal transitions only ever clear. There is no second rights tracker.

### History convention and trust boundary

- A history is a readonly list of `RepetitionKey`s, one for every committed position:
  - the initial position first;
  - then one entry for each accepted move;
  - ending with the current position.
- An intended-claim evaluation never appends to it.
- The evaluators require the last entry to match the current position; otherwise they return `history_not_current`.
- The rules package evaluates the history it is given. It cannot prove that the caller is trustworthy. The Live Game authority owns the history and that trust boundary, and a client never submits history or a FEN as authority.
- For the fifty-move rules, the state input is the canonical halfmove clock maintained by legal transitions.

### Claims (Articles 9.2, 9.3, 9.5.2, 9.5.3)

`evaluateDrawClaim(history, position, claim)` judges a claim by the side to move and returns a frozen assessment. The verdict is `correct`, or `incorrect` with `opponentBonusMs: 120000`.

| Claim kind | Correct when |
|---|---|
| `threefold_current` | The current identity has occurred at least 3 times, counting the current one |
| `fifty_move_current` | The halfmove clock is at least 100 |
| `threefold_intended` | The intended move, applied hypothetically, creates the third or later occurrence |
| `fifty_move_intended` | The intended move, applied hypothetically, takes the halfmove clock to at least 100 |

For intended claims, the move is resolved through the same legal-move authority as `applyLegalMove`. The outcome for the intended move is one of:

- `not_applied`: the claim is correct. The move proves the claim, and the game is drawn without playing it.
- `must_apply`: the claim is incorrect and the move is legal. The resulting position is returned as evidence, and the Live Game authority must then play the move (9.5.3).
- `illegal`: the move is illegal and must not be applied. The `LegalMoveError` is preserved.

Every claim returns `evidence`: the judged position (the hypothetical one for intended claims) and its occurrence count. The only exception is an illegal intended move, where `evidence` is `null`.

- Neither the position nor the history is mutated.
- 120000 ms is a rule fact only. No clock exists, and it is not an abandonment threshold, increment, or lag allowance.
- Network response codes are not part of this domain.

### Automatic facts (Articles 9.6.1, 9.6.2)

`evaluateAutomaticDraws(history, position)` returns the explicit facts `{ fivefold, seventyFiveMove }` without ranking them.

- `fivefold` is true once the current identity has occurred at least 5 times.
- `seventyFiveMove` is true once the halfmove clock is at least 150, unless `evaluateMoveExhaustion` reports checkmate, which takes precedence.
- Threefold and 100 halfmoves are never automatic, and fivefold and 150 halfmoves never need a claim.
- `evaluateMoveExhaustion` is reused, not merged. Event ordering and GameResult are later work.

### Ledger status changes

**Now IMPLEMENTED:**
- 011b (the corrected SAN).
- 018, 018b, 019, 020, 020b: pure claim and automatic facts.
- 021a: a 150-ply quiet history built by legal moves.
- 021b: mate on halfmove 150 suppresses the seventy-five-move fact.
- 023a: KQkq versus KQk, reached by a legal rook excursion; a placement-only count would be 3, but the true count is 2, so the claim is incorrect.
- 023b: histories with and without legal en passant, plus the unreachable-target and pinned-pawn regressions.

**PARTIAL:**
- 020c, 022a, 022b, 022c. The incorrect verdict, the 120000 ms fact, and the `must_apply` or `illegal` disposition are asserted.
- Their ledger text also expects the opponent's clock to change and, for 020c and 022b, the move to be applied. That is Live Game work.
- The ledger wording was not changed; it describes product behaviour.

The ledger-status header now maps draw-claim and automatic-draw wording to these rule facts.

### Tests

- `repetition.test.ts`: TST-FOUND-REP-001–008, 023a, 023b. Covers the key format, clocks being ignored, side, placement, castling, legal en passant, counts that need not be consecutive, frozen keys, and the history convention.
- `draw-rules.test.ts`: golden rows 018–022c and TST-FOUND-DRAW-001–004. Covers the history precondition, the thresholds 99/100/149/150 and 3/4/5, a preserved promotion error, and frozen results.
- `repetition.property.test.ts`: TST-FOUND-REPPROP-001–003.
  - Clocks never change the identity, and the side to move always does.
  - An en passant target matters exactly when an oracle built from `generateLegalMoves` finds a legal pawn move onto it.
  - Identity equality agrees with that oracle for every pair of positions along a playout.
- `support/rule-history.ts` (test-only): builds histories through `applyLegalMove`, and walks 150 quiet moves with no pawn move, capture, or check.

A mutation check deliberately broke four things in turn, and each was caught:

| Injected bug | Failing tests |
|---|---|
| Raw en passant target used | 3 |
| Pseudo-legal en passant used | 3 |
| Mate suppression inverted | 1 (021b) |
| Hypothetical position not counted | 2 (018b, 022b) |

### Movement, SAN, and gates

- Every perft vector is unchanged and passes, and every SAN test passes. Legal move generation was not modified.
- 24 test files: 292 passed, 0 failed, 0 skipped, 16 todo. Todo fell from 29 because 13 NOT_IMPLEMENTED rows now have evidence.
- Dependencies added: 0. No casts, ts-ignore, or ts-expect-error. The boundary rules are unchanged.
- A doc comment first wrote out the ruleset id and broke TST-FOUND-RULESET-004 (single source of the id). It was reworded.

### Self-review

- **Raw en passant target, or a pinned pawn changing identity?** No. REP-005, 023b, and REPPROP-002 test this.
- **Clocks inside the identity?** No.
- **Castling represented twice?** No.
- **Threefold or 50 automatic, or fivefold or 75 claim-only?** No. DRAW-002 tests this.
- **Can a correct intended claim mutate state?** No. 018b and 020b test this.
- **Does an incorrect legal claim expose `must_apply`?** Yes. 020c and 022b test this.
- **Can an illegal intended move be applied?** No. 022c and DRAW-003 test this.
- **Is 120000 ms applied to anything?** No, it is a fact only.
- **Does checkmate beat 75?** Yes. 021b tests this.
- **SAN used for identity, or a hash collision risk?** No.
- **Perft or SAN changes?** None.
- **Server behaviour added?** None.

### Remaining gaps

- No ClaimDrawCommand processing, clock application of 9.5.3, GameResult, events, draw agreement, resignation, timeout, or PGN.
- If a claimed intended move would itself give checkmate, the claim is still judged only on repetition or the halfmove count. Live Game ordering must decide such cases.
- Claims or facts on a position whose game has already ended are not guarded here; that is Live Game work.
- Dead-position detection is still partial (GAP-MATE-001 to 004), and 3.10.3 reachability is not proven.
- ENV-NODE-001 is open.

### Batch 4.1: en passant identity review correction

- **Finding:** the independent review of Batch 4 found that an occupied en passant target could enter the repetition identity. A canonical Position is structurally valid but not guaranteed to be reachable, so its raw target can name an occupied square.
- **Failing regression first:** TST-FOUND-REP-009 was added before any production change and failed against the Batch 4 code, on `samePositionForRepetition`:
  - `4k3/8/3b4/4P3/8/8/8/4K3 w - d6 0 1` against the same FEN with `-`;
  - the black mirror `4k3/8/8/8/4p3/3B4/8/4K3 b - d3 0 1` against the same FEN with `-`.
  - In both, the pawn capture onto the bishop is legal with and without the target, and clearing the target changes no legal move.
- **Root cause:** `effectiveEnPassant` accepted any legal move by an adjacent own pawn onto the target. A normal capture onto an occupied target satisfied that.
- **Fix:** the target is effective only if some move from `generateLegalMoves` goes to the target and `enPassantVictim` identifies it as en passant. `enPassantVictim` already returns nothing for an occupied destination. The pawn geometry was removed from `repetition.ts`, so it holds no en passant rules of its own. `move-generation.ts`, legal moves, transitions, and SAN are unchanged.
- **Stronger property oracle:** REPPROP-002 and 003 no longer look for a pawn move onto the target. The oracle rebuilds the position with the target cleared and treats the target as effective exactly when the public legal move sets differ. It uses no internal en passant helper. The two regression FENs were added as playout starts.
- **Mutation check:** with the `enPassantVictim` condition temporarily disabled, so that any legal move onto the target counted (the old blind spot), REP-009, REPPROP-002, and REPPROP-003 failed; fast-check shrank to the black regression start. The fix was then restored.
- **Wording:** the key is now described as unambiguous, space-delimited canonical text rather than fixed-width, because the en passant field is `-` or two characters.
- The Batch 4 thresholds, history convention, claim model, castling identity, and ledger statuses are unchanged. `repetition.ts` is now 122 lines.
- **Gates:** 24 test files, 293 passed, 0 failed, 0 skipped, 16 todo. Perft and SAN are unchanged. Typecheck, lint, format, boundaries, check, and audit are recorded in the Batch 4.1 review bundle.
- Dependencies added: 0. `package.json` and `pnpm-lock.yaml` are unchanged. Batch 4 and 4.1 remain uncommitted.

## Toolchain maintenance — 2026-09-28

Owner-authorized, controlled update inside the approved Node 24 LTS and pnpm 12 families. No product code changed.

### Batch 4 + 4.1 commit

- `pnpm check` passed on the old toolchain after six new Batch 4 `.ts` files, which had been converted to CRLF outside the gates, were normalized back to LF. Their content was verified identical to the reviewed Batch 4 and 4.1 review-bundle copies.
- Committed locally as `bc9e149` "feat: add repetition and draw rule facts". There is no remote and nothing was pushed. The toolchain changes below are uncommitted, for review.

### Versions

| Tool | Before | After | Notes |
|---|---|---|---|
| Node.js | 24.14.1 | 24.21.0 | Latest Node 24 LTS ("Krypton", 2026-09-07). Official `node-v24.21.0-x64.msi` from nodejs.org, in-place upgrade of the existing install |
| npm | 11.11.0 | 11.19.0 | Bundled with Node; not updated separately |
| pnpm | 12.6.0 | 12.7.0 | Run with `npx --yes pnpm@12.7.0 <command>`; no global install, corepack not enabled |

- Node verification:
  - The SHA-256 of the MSI matched the official `SHASUMS256.txt` entry `bb0eaee134f9357f22aea915ee793343e627aefc1e66488164bac6915bce2cac`.
  - The MSI and the installed `node.exe` both carry a valid Authenticode signature from the OpenJS Foundation.
  - Install: x64 on 64-bit Windows, at `C:\Program Files\nodejs\node.exe`. It is the only Node.js on PATH, and no version manager is installed.
- **pnpm channel:** the npm `latest` and `latest-12` tags still point at 12.6.0. 12.7.0, 12.8.0, and 12.8.1 are published under `next-12`, and GitHub lists all three as normal releases, not prereleases.
  - 12.7.0 was chosen because it matches the reviewed 12.7.x target and has been out since 2026-09-25.
  - 12.8.x was not taken: it is outside the reviewed target, and 12.8.1 was published on the day of this update.
- **Pins:**
  - `packageManager` is `pnpm@12.7.0`.
  - `engines.pnpm` is `12.7.0`. It had to move with `packageManager` because `pnpm-workspace.yaml` sets `engineStrict: true`.
  - `engines.node` is unchanged (`>=24.11.0 <25.0.0`).

### Direct dependencies

| Package | Before | After | Newest stable | Newest in approved major | Action |
|---|---|---|---|---|---|
| typescript | 7.0.2 | 7.0.2 | 7.0.2 | 7.0.2 | KEEP |
| @biomejs/biome | 2.5.14 | 2.5.14 | 2.5.14 | 2.5.14 | KEEP |
| vitest | 5.0.2 | 5.0.2 | 5.0.2 | 5.0.2 | KEEP |
| fast-check | 4.10.2 | 4.10.2 | 4.10.2 | 4.10.2 | KEEP |
| @types/node | 24.19.0 | 24.19.0 | 26.6.3 | 24.19.0 | KEEP; 26.x deferred, it types Node 26 |

- **TypeScript:** it stayed at 7.0.2, so no AST compatibility migration was needed for the boundary checker. TST-BOUNDARY-001 to 019 and `check:boundaries` (67 files) still pass on the new toolchain.
- **Lockfile:** the only change is the pnpm self-entry (`packageManagerDependencies`): `pnpm` and its 14 `@pnpm/exe.*` platform packages, 12.6.0 to 12.7.0, with version and integrity lines only.
  - The pnpm@12.7.0 integrity matches the registry.
  - Project packages: 94 before and after. pnpm self-entries: 15 before and after.
- No transitive pins or overrides were added.

### Security and supply chain

- `pnpm audit`: no known vulnerabilities.
- All 109 lockfile packages have sha512 integrity.
- There are no tarball, git, or `file:` sources. The only `link:` entries are the internal workspace packages.
- No installed package has a preinstall, install, or postinstall script, and no package is deprecated.
- Native binaries are unchanged and all come from existing dependencies: the Biome, TypeScript 7, rolldown, and lightningcss platform packages.

### Gates on Node 24.21.0 and pnpm 12.7.0

- typecheck, lint, format:check, check:boundaries, test, test:rules, check, and audit all pass.
- 24 test files: 293 passed, 0 failed, 0 skipped, 16 todo, identical to the pre-maintenance baseline.
- Perft vectors are unchanged. SAN, repetition, draw, and golden rows 018 to 023b are unchanged and passing.

ENV-NODE-001 is **RESOLVED**: it was opened for Node 24.14.1, and Node 24.21.0 is now the active runtime.

After review, the toolchain changes were committed locally as `9e280db` "chore: update node 24 toolchain baseline". There is no remote and nothing was pushed.

## Batch 5: authoritative live game foundation (in memory)

Owner-authorized. Baseline `9e280db`. Batch 5 is uncommitted, for review. Batch 6 is not authorized. This batch builds no HTTP, WebSocket, Fastify, database, outbox, reconnect, matchmaking, rating, resignation, draw offer, UI, or deployment.

### Package

`server/live-game` (`@chess-one/live-game`) depends only on the public entries of `@chess-one/game-values` and `@chess-one/chess-rules` (DEC-045: the rules library stays separate from the live authority, and chess logic is not duplicated). No `contracts/` package was created; command names and versions live in `commands.ts`.

| File | Lines | Responsibility |
|---|---|---|
| `ids.ts` | 36 | Branded `GameId`, `PlayerId`, `CommandId`, `ControlLeaseId` with type guards; caller-supplied, no generation, no randomness |
| `clock.ts` | 144 | `MonotonicMs` (DEC-061, DEC-063), audit-only `WallClockMs`, sudden-death `ClockState`, receipt timing, charge, pass, stop, add time, flag |
| `commands.ts` | 148 | `SubmitMoveCommand.v1` and `ClaimDrawCommand.v1` input shapes, normalization, and shape validation |
| `command-identity.ts` | 57 | Fingerprint, binding lookup and storage, stored-response replay |
| `result.ts` | 125 | `GameResult`, `GameStatus`, position facts from chess-rules, approved precedence only |
| `events.ts` | 58 | `game.finished.v1` domain shape |
| `active-game.ts` | 156 | `ActiveGameState`, response and binding types, `createActiveGame` |
| `process-command.ts` | 399 | `processCommand` and `processDeadline` |
| `index.ts` | 59 | Public entry |

### State model

- `ActiveGameState` is deeply frozen:
  - `gameId`, `rulesetId`, the seat-to-player map, and the seat-to-lease map;
  - the canonical `Position`, the repetition history (one key per committed position), and `sequence`;
  - `clock`, `status`, and `commandBindings`.
- `createActiveGame` takes caller-supplied ids, leases, a sudden-death time control, and the trusted start instant. It starts at sequence 0 with a one-key history and the start position's side to move on the clock.
  - The optional start position is a trusted server seam, never client input.
  - Creation rejects: one player on both seats, a shared lease, a zero budget, and a start position that is already finished.
- `status` is one of:
  - `active`;
  - `finished` with an immutable `GameResult`;
  - `unresolved` with MATING_POSSIBILITY_UNRESOLVED (a flag) or TERMINAL_PRECEDENCE_UNRESOLVED (checkmate beside another fact).
  - Only `active` accepts commands.

### Decision model

`processCommand(state, actor, command, ingress)` returns `{ nextState, response, events }`. It is pure and deterministic: no `Date`, `performance`, randomness, I/O, or timers. The input state is never modified.

- `AuthorizedGameActor` (game, player, seat, lease) comes from the trusted caller. No command field establishes identity, seat, lease, or time.
- `Ingress.receivedAtMonotonicMs` is the writer-domain receipt instant. `auditWallClockMs` is audit only: it appears on the event and decides nothing.
- `processDeadline(state, observedAt)` is the writer's own timer check for a side that sends nothing.
- Internal defects throw `Error`:
  - out-of-order receipt;
  - a history that does not end at the position;
  - sequence overflow.
  - These are programming errors, not domain codes. Because each decision is built from frozen values, a throw leaves the caller's state untouched (TST-LIVE-090 to 092).

**Processing order** (CONTRACT_CATALOG_V1 2.3):

1. Shape: `InvalidState`, not bound.
2. Game, player, seat, lease, and `actor_id` echo against the trusted actor: `Unauthorized`, not bound.
3. Identity:
   - a stored binding with the same fingerprint returns the stored response with `replayedResponse = true`, the same state object, and no events;
   - a different fingerprint returns `InvalidCommandIdentity`.
4. A finished game is `GameAlreadyFinished` (bound). An unresolved game is rejected with its reason code (not bound). (Corrected in Batch 5.2, below: `GameAlreadyFinished` for a new command is not bound.)
5. The seat must be the side to move: `NotYourTurn`, bound.
6. `expected_game_sequence` must be current: `StaleSequence`, not bound.
7. Deadline at `received_at`.
8. Legality through chess-rules, then the transition.

Replay precedes the finished guard, so a stored accept is still replayed after the game ends.

**Sequence and identity:**

- Sequence 0 is the created game. Each committed transition adds exactly one:
  - an accepted move;
  - a correct claim;
  - an incorrect claim, with or without its applied move;
  - an illegal intended move with penalty;
  - a flag.
- Replays and rejections never change it.
- Binding rejections (`IllegalMove`, `NotYourTurn`, `GameAlreadyFinished`, and a well-formed `InvalidState`) add only a binding. (Corrected in Batch 5.2, below: `GameAlreadyFinished` is no longer a binding rejection.)
- The fingerprint is canonical text: command name, `game_id`, and the normalized move or claim fields. It excludes client time, client SAN, `actor_id`, `expected_game_sequence`, session, and lease (contract 2.6). (Corrected in Batch 5.1, below: the lease is now included.)
- Bindings are keyed by seat and client command id, and kept for the life of the state. Production retention is TBD.

### Clock (DEC-042, DEC-061, DEC-063)

- Integer ms balances; the running side's balance was settled at `anchorMs`. Elapsed time is `received_at - anchor`. Processing after receipt is never charged.
- **Deadline boundary:** receipt at or before the deadline is timely (LIVE_GAME_EVENT_ORDERING_V1 section 3, which decides the exact-boundary case). The Batch 5 prompt's "zero or below is too late" wording differs; the document was followed.
- **Rejected commands:** they change no clock field. The contract gives them "State change: No", and the server clock keeps running from the turn anchor, so the next committed transition charges the whole interval once (TST-LIVE-064). This is decided by the documents, so LIVE-CLOCK-POLICY-001 was not raised.
- **Committed claims:** the claimant is charged to the claim's receipt, then the +120000 ms penalty goes to the opponent (ordering section 5, contract 10.1).
- **Late commands:** the move or claim is not applied and is never checkmate. The flag is committed:
  - the flagged balance becomes 0 and the clock stops;
  - sequence +1;
  - status MATING_POSSIBILITY_UNRESOLVED with the flagged side;
  - no result and no event (DEC-064);
  - the response code is `MoveReceivedAfterDeadline`, not bound. (Corrected in Batch 5.1, below: the late command is now bound.)
  - Every flag is unresolved, because who can mate is a one-sided question (GAP-MATE-004) that no reviewed function answers.

### Results and events

- **Position facts after a committed move, in a fixed order:**
  - checkmate or stalemate;
  - fivefold;
  - seventy-five-move;
  - dead position (PROVEN_DEAD only).
- **Precedence:** only the approved rule applies. Checkmate outranks seventy-five-move, and chess-rules already suppresses the latter. Draw facts that coexist are all kept as `drawRuleDetails`. Checkmate beside any other fact is held TERMINAL_PRECEDENCE_UNRESOLVED.
- A correct claim finishes as `draw_rule` with `threefold_claim` or `fifty_move_claim`.
- `GameResult` exists only for checkmate and rule draws. There is no result for time, resignation, agreement, or abandonment.
- `game.finished.v1` is emitted only in the decision that commits `finished`, so exactly once. It carries:
  - producer `live_game_authority`, game id, sequence, and ruleset;
  - players, result, final FEN, and final clock;
  - wall-clock audit time and provenance.
  - It is not published. The durable commit, the outbox, and `event_id` are later work.

### Claims (contract 10.1)

| Claim | Response | Effect |
|---|---|---|
| Correct, current or intended | `Accepted` | Drawn at receipt. An intended move is not applied. +1 sequence. One event |
| Incorrect current | `IncorrectClaim` | Opponent +120000 ms. The claimant keeps the move. +1 sequence |
| Incorrect with a legal intended move | `IncorrectClaim`, server SAN | +120000 ms, then the move is applied in the same transition. +1 sequence, +1 history |
| Illegal intended move | `IllegalMove` (`illegal_move`) | +120000 ms. The move is not applied. +1 sequence |
| Intended move with a missing or unexpected promotion | `InvalidState` | Binding only, no penalty |

Replays return the stored response; the penalty is never added twice.

### Not implemented

- **Resignation:** `ResignGame` is NOT_IMPLEMENTED. Every outcome would need the one-sided check (GAP-MATE-004), and the contract's "`NOT_DEAD` is a loss" wording has the same conflict as timeouts (below).
- **Also not built:** draw offers and agreement, abort and no-start handling, reconnect and snapshot transport, Fischer, Bronstein, or multi-stage clocks, persistence, and the outbox.

### Contract conflicts and gaps

- **LIVE-CONTRACT-001:** the contract and ordering text say "`NOT_DEAD` → loss on time or resignation". Whole-position `NOT_DEAD` does not prove that the flagger's opponent can mate. For example, in K+Q versus K where the queen side flags, the result must be a draw under 6.9. The implementation therefore holds every flag unresolved. Because `assessMatingPossibility` never returns `NOT_DEAD`, the behaviour today is identical either way. Owner decision needed before any time or resignation result.
- **LIVE-CONTRACT-002:** the catalog names no response code or binding status for a command received after the deadline. `MoveReceivedAfterDeadline` is used, not bound; a retry receives the unresolved or finished guard response. (Corrected in Batch 5.1, below: the late command is bound, and an exact retry replays `MoveReceivedAfterDeadline`.)
- **LIVE-CONTRACT-003:** the catalog's `game.finished.v1` has `event_id` and `occurred_at` but no id source for a pure domain. `event_id` is left to the future outbox, and `occurred_at` comes from trusted audit wall-clock time or is null.
- **LIVE-ORDER-001:** contract order checks turn and sequence before the deadline. A command from the side not to move, or with a stale sequence, never triggers the other side's flag; the writer's `processDeadline` timer must do that.

### Boundaries

- A `DOMAIN_POLICIES` entry for `server/live-game/src/` applies:
  - allowed packages: game-values and chess-rules only;
  - the same ambient, evaluation, and import-cycle bans;
  - `relative_escape`, a manifest `forbidden_dependency` check, and a single public entry.
- Relative reach into `server/*/src/` from outside is now `deep_import_bypass`.
- `biome.json` now includes `server/**`; before this change, lint and format did not see live-game. Root `typecheck` and `check` include `tsc -p server/live-game`.
- New tests:
  - TST-BOUNDARY-020 to 023: live-game imports, ambient bans, reverse dependency, internals, and the manifest;
  - TST-BOUNDARY-024: typecheck and Biome coverage of every source package.
- Workspace: `server/*` was added to `pnpm-workspace.yaml`. The lockfile gained only two `link:` importers (`server/live-game`, `tests/live-game`). No external package was added.

### Tests (tests/live-game, 56 tests)

- `submit-move.test.ts`:
  - creation;
  - legal, illegal, promotion, and wrong-turn moves;
  - leases, players, and games;
  - actor echo, replay, conflict, seat scope, and fingerprint;
  - client SAN, client time, and shapes;
  - stale and unauthorized commands not locking an id;
  - checkmate, stalemate, fivefold, seventy-five, and mate beside seventy-five;
  - coexisting draws and dead positions (including the ledger 014a to 014c placements);
  - terminal absorption and audit time.
- `draw-claims.test.ts`: the four correct claims, all incorrect paths, penalty replay, promotion shape, turn, and claim shapes.
- `clock.test.ts`:
  - elapsed time;
  - scenario A (received before the deadline, processed after it);
  - scenario B (exact boundary is timely);
  - scenario C (late, not applied, unresolved flag);
  - scenario D (rejections consume no clock);
  - late claims and UNKNOWN never producing a result;
  - `processDeadline`;
  - mate at the last timely instant, and mating squares arriving late;
  - dead positions leaving no later flag.
- `properties.property.test.ts`: random bounded sessions (60 runs, at most 40 steps, fixed seed) check that:
  - replays and conflicts never change state;
  - rejections never change the sequence;
  - a commit adds exactly +1, and a move adds +1 history;
  - terminal states are absorbing;
  - clocks are never negative;
  - the penalty is added exactly once;
  - positions stay canonical;
  - events fire once.
  - A coverage assertion requires every response path. A second property replays every command of a session.
- `failure-injection.test.ts`: defects leave the input unchanged.
- `source-policy.test.ts`: no ruleset literal, no suppression comments, no assertion casts.

### Ledger

- `ledger-status.test.ts` now also reads `tests/live-game` titles.
- Moved to IMPLEMENTED by live-game assertions: 001, 014a, 014b, 014c, 016b, 016c, 016e, 020c, 022a, 022b, 022c, 024, 025, 026, 027, 028.
- 016d is PARTIAL: no flag result stands without GAP-MATE-004.
- Still NOT_IMPLEMENTED: 015a to 015c (resignation), 016a (`NOT_DEAD` time loss), and 017a to 017c (draw offers).

### Gates (Node 24.21.0, pnpm 12.7.0, TypeScript 7.0.2)

- typecheck, lint, format:check, check:boundaries, test, test:rules, check, and audit all pass.
- 30 test files: 354 passed, 0 failed, 0 skipped, 7 todo.
  - rules: 274 passed and 7 todo. These are the 274 baseline rules tests, unchanged.
  - boundaries: 24.
  - live-game: 56.
- The 293 baseline tests (274 rules + 19 boundaries) all still pass. The todo count fell from 16 to 7 because nine ledger rows are now asserted.
- Dependencies added: 0. `package.json` changed only its two typecheck scripts. `pnpm-lock.yaml` changed only by the two workspace importers.

## PHASE 1 / BATCH 5.1 — IDEMPOTENCY REVIEW CORRECTIONS

Owner-authorized targeted corrections to Batch 5. Baseline `9e280db`. Batch 5 and 5.1 are uncommitted, for review. Batch 6 is not authorized. No clock, deadline, chess-rules, boundary, package, or lockfile change. Phase 0 documents are unchanged.

### Defect A: the fingerprint ignored the control lease

- **Old behaviour:** the fingerprint was command name, `game_id`, and the normalized move or claim fields. It left out the lease. After a lease replacement, a controller holding the new lease could send an old `client_command_id` with the same payload and receive the decision stored under the earlier lease as a replay.
- **Fix:** `fingerprintOf` now binds the normalized authoritative `control_lease_id`:
  - `SubmitMove`: command name and version, `game_id`, lease, and normalized from, to, and promotion;
  - `ClaimDraw`: command name and version, `game_id`, lease, claim kind, and the normalized intended move when present.
  - The lease is compared only after authorization has checked it against the seat's current lease.
  - Still excluded: client SAN, client observed time, the `actor_id` echo, `expected_game_sequence`, and `client_command_id` (the lookup key together with the seat).
- The same id under a replacement lease is now `InvalidCommandIdentity`, with no state change and no events. The same id, payload, and original lease still replays.
- There is no production takeover API. The test seam `withRotatedLease` (in `tests/live-game/support/harness.ts`) builds the state a future lease replacement would produce.

### Defect B: a late client command was not bound

- **Old behaviour:** a late, valid, authorized command committed the flag but stored no binding. An exact retry fell through to the unresolved guard and received `MatingPossibilityUnresolved` instead of its original response.
- **Fix:** the late branch now uses the existing `bound()` helper, so one pure transition:
  1. commits the flag once, with the flagged balance at 0, the clock stopped, and the sequence +1;
  2. sets status MATING_POSSIBILITY_UNRESOLVED;
  3. responds `MoveReceivedAfterDeadline`;
  4. stores the binding (seat, `client_command_id`, fingerprint, original response);
  5. emits no event.
- An exact replay returns the original response with `replayedResponse = true`, the same state object, and no events: no second flag, sequence, clock, or history change. The same id with a different payload is `InvalidCommandIdentity` with no change.
- No move is applied, no claim is evaluated, and no penalty is added.
- `processDeadline` has no client command, so it binds nothing. No placeholder binding was invented.
- **Invariant (documented in `process-command.ts`):** every client command that reaches a committed transition is bound in the same returned state, under the one lease-scoped fingerprint. That covers an accepted move, a correct claim, an incorrect claim, and a late flag. The property test now asserts it for every committed client decision.
- `process-command.ts` is 403 lines (399 before). `command-identity.ts` is 60 lines (57 before). No refactor and no file split.

### Red tests before the fix

`tests/live-game/idempotency.test.ts` was written and run before the production change: 7 tests, 6 failed, 1 passed.

- TST-LIVE-100 (a rotated lease reusing an id with the same payload) failed: it received a replayed `Accepted`.
- TST-LIVE-102, three cases (late `SubmitMove`, late current claim, late intended claim), failed: no binding was stored.
- TST-LIVE-103 (the same id with a different payload after a late binding) failed: it received `MatingPossibilityUnresolved`.
- TST-LIVE-104 (the late binding's fingerprint) failed: no binding existed.
- TST-LIVE-101 (the same id, payload, and original lease still replays) passed, as expected.

After the fix, all 7 pass.

### Tests updated

- TST-LIVE-033 now asserts that the fingerprint:
  - ignores formatting after normalization, client SAN, client observed time, the `actor_id` echo, `expected_game_sequence`, and `client_command_id`;
  - changes with the move, `game_id`, command kind, claim kind, intended move, or lease.
- TST-LIVE-063 (a late command) now expects one binding, and an exact retry that replays `MoveReceivedAfterDeadline`. A claim under a new id is still `MatingPossibilityUnresolved`.
- The replay property (TST-LIVE-081) no longer skips late commands.
- The exact-deadline tests (receipt at the deadline is timely) are unchanged and pass.

### Confirmed owner decisions (recorded, not implemented beyond Batch 5)

- **A. Exact deadline:** `received_at <= deadline` is timely. `receiptTiming`, DEC-061, and DEC-063 are unchanged.
- **B. One-sided mating question:** whole-position `NOT_DEAD` is not enough for a time or resignation result. The question is: "Can the opponent of the flagging or resigning side achieve checkmate by any legal series of moves?" (GAP-MATE-004). LIVE-CONTRACT-001 stands.
- **C. UNKNOWN:** stays MATING_POSSIBILITY_UNRESOLVED. Every flag is unresolved, and there is no time result (DEC-064).
- **D. Resignation:** stays NOT_IMPLEMENTED (ledger 015a to 015c).

### Gates (Node 24.21.0, pnpm 12.7.0, TypeScript 7.0.2)

- typecheck, lint, format:check, check:boundaries, test, test:rules, check, and audit all pass (exit 0). Audit: no known vulnerabilities.
- 31 test files: 361 passed, 0 failed, 0 skipped, 7 todo.
  - rules: 274 passed and 7 todo. Perft, SAN, repetition, and draw tests are unchanged.
  - boundaries: 24.
  - live-game: 63 (56 + 7).
- The 293 baseline tests (274 rules + 19 boundaries) all pass. `domain/` has no diff against `9e280db`.
- Dependencies added: 0. Batch 5.1 did not change `package.json` or `pnpm-lock.yaml`.
- Traceability is unchanged: its Batch 5 rows remain accurate.

## PHASE 1 / BATCH 5.2 — TERMINAL ABSORPTION CORRECTION

Owner-authorized narrow correction. Baseline `9e280db`. Batch 5, 5.1, and 5.2 are uncommitted, for review. Batch 6 is not authorized. No fingerprint, clock, deadline, mating-policy, chess-rules, boundary, package, or lockfile change.

### Previous behaviour

- A new command (an id with no stored binding) against a `finished` state went through `bindRejection(..., "GameAlreadyFinished")`. That appended a `CommandBinding` and returned a new state object.
- So a finished state was not fully absorbing. Every fresh post-game `client_command_id` grew `commandBindings` without limit, although the command decided nothing and protected no committed transition. That is unbounded memory growth an abusive client can drive, and it would become unbounded durable storage once bindings are persisted.

### Corrected behaviour

- The identity lookup still runs before the terminal guard, in contract 2.3 order:
  - a binding stored before the finish replays its original response with `replayedResponse = true`, the same state object, and no events;
  - the same id with a different fingerprint is `InvalidCommandIdentity`, with the same state object.
- A new command against a finished state is `GameAlreadyFinished` through the non-binding `reject()`:
  - `nextState` is the same state object;
  - no binding, sequence, clock, position, history, or status change;
  - no event.
- The same new command sent again is evaluated again and answers `GameAlreadyFinished` again, with `replayedResponse = false`. There is no committed transition to protect, so no stored idempotency is needed.
- **Terminal absorption invariant:** after `status.kind === "finished"`, every later command returns the same `ActiveGameState` object, including `commandBindings`. Existing bindings stay readable, and none are created after the finish.
- `processDeadline` on a finished state already returned the same state (unchanged).
- Other binding policies are unchanged:
  - `IllegalMove`, `NotYourTurn`, the late-command flag, and correct and incorrect claims remain bound;
  - `InvalidState` (binding only when well-formed and judged), `StaleSequence`, and `Unauthorized` are unchanged;
  - unresolved games already answered with an unbound rejection.
- `process-command.ts` is 405 lines (403 before): a one-line change from `bindRejection(judged, …)` to `reject(attempt, …)`, plus doc comments.

### Contract deviation (owner-directed)

- **LIVE-CONTRACT-004:** CONTRACT_CATALOG_V1 section 2.6 and PHASE_0_5_CONTRACT_CORRECTIONS section 3 list `GameAlreadyFinished` among the binding decisions. By owner direction in Batch 5.2, a new post-finish command is not bound.
- Visible difference: repeating such a command answers `GameAlreadyFinished` with `replayedResponse = false` instead of `true`. A different payload under that unbound id also answers `GameAlreadyFinished` instead of `InvalidCommandIdentity`. Both are no-change rejections, and no result can be altered.
- The Phase 0 documents are not edited here. An owner amendment of section 2.6 would align them.

### Red test before the fix

In `tests/live-game/idempotency.test.ts`:

- **TST-LIVE-105** (a new command after checkmate) was run first and failed: the returned state was a new object with one more binding.
- **TST-LIVE-106** (bindings made before the finish replay after it: the opening move and the mating move) passed before and after.
- **TST-LIVE-107** (a stored id with a different payload after the finish is `InvalidCommandIdentity`) passed before and after.
- Before the fix: 10 tests in the file, 1 failed. After the fix, all pass.

### Tests updated or added

- TST-LIVE-030 (post-finish commands) is superseded: new commands are now unbound, pure rejections that return the same state object, and a repeat is not a replay. The result object is unchanged.
- TST-LIVE-071 (a dead-position finish, then a late command) now asserts the same state object.
- The session property (TST-LIVE-080) now requires the same state object for every command against a finished state.
- **New TST-LIVE-082:** random commands against a checkmated game always return the same state object and no event. The commands mix new moves, claims, wrong seats, stale sequences, malformed squares, replays of commands from before and after the finish, and id conflicts. Stored decisions replay unchanged, and everything else is `GameAlreadyFinished`, `InvalidCommandIdentity`, or `InvalidState`.

### Gates (Node 24.21.0, pnpm 12.7.0, TypeScript 7.0.2)

- typecheck, lint, format:check, check:boundaries, test, test:rules, check, and audit all pass (exit 0). Audit: no known vulnerabilities.
- 31 test files: 365 passed, 0 failed, 0 skipped, 7 todo.
  - rules: 274 passed and 7 todo, unchanged.
  - boundaries: 24.
  - live-game: 67 (63 + 4).
- `domain/` has no diff against `9e280db`.
- Dependencies added: 0. `package.json` and `pnpm-lock.yaml` are unchanged by Batch 5.2.
- Traceability is unchanged: FR-GM-010 already states that a finished game is absorbing.

## Batch 5 closure (review passed)

Batch 5, 5.1, and 5.2 passed independent review and were approved by the owner on 2026-09-28. Closing documentation, with no code change:

- **LIVE-CONTRACT-004: RESOLVED.** `CONTRACT_CATALOG_V1.md` now carries the approved rule as section 2.6.1. The 2.3 step 4, 2.5 row, and 2.6 binding list point to it, and the superseded Phase 0.5 wording is kept and marked. `PHASE_0_5_CONTRACT_CORRECTIONS.md` section 3 has a pointer to the correction. The contract deviation recorded in Batch 5.2 is closed.
- **Exact deadline** is recorded in `PHASE_0_DECISION_CHANGELOG.md` section 13 as a clarification of DEC-061 and DEC-063: `received_at <= deadline` is timely, and `received_at > deadline` is late. The receipt is in the writer's monotonic domain, and processing after receipt is not player time.
- **LIVE-CONTRACT-001** stays OPEN with an approved direction (changelog section 13): the timeout and resignation question is one-sided (can the opponent of the flagging or resigning player mate by any legal series?). Whole-position `NOT_DEAD` is not sufficient. `MATING_POSSIBILITY_UNRESOLVED` stays mandatory until that is proven. Batch 6 is authorized to resolve it.
- **Known documentation inconsistency, not changed here:** `CONTRACT_CATALOG_V1.md` 2.6 and `PHASE_0_5_CONTRACT_CORRECTIONS.md` section 3 still list `control_lease_id` outside the fingerprint. The owner-approved Batch 5.1 correction binds the lease. The closure instruction limited contract edits to LIVE-CONTRACT-004, so this remains for an explicit owner amendment.
