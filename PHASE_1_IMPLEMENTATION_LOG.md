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
- **LIVE-CONTRACT-003:** the catalog's `game.finished.v1` has `event_id` and `occurred_at` but no id source for a pure domain. `event_id` is left to the future outbox, and `occurred_at` comes from trusted audit wall-clock time or is null. (*Resolved in Batch 8: `PHASE_0_DECISION_CHANGELOG.md` section 17.*)
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

## PHASE 1 / BATCH 6 — ONE-SIDED MATING CAPABILITY

Owner-authorized. Baseline is the Batch 5 commit `d152afc` ("feat: add authoritative live game foundation"). Batch 6 is uncommitted, for review. No remote, no push. Batch 7 is not authorized.

### Owner decisions taken during the batch

- **King and bishop, or king and knight, against a lone king:** the request listed these as `PROVEN_CAN_MATE`. That is false; no cooperative mate exists. Asked and decided: `PROVEN_CANNOT_MATE` for the minor-piece side, backed by an exhaustive in-repo test. Test titles say "no cooperative mate exists".
- **Lease fingerprint documentation:** amend. `CONTRACT_CATALOG_V1.md` 2.6.2 and `PHASE_0_5_CONTRACT_CORRECTIONS.md` section 3 now record the Batch 5.1 lease-scoped fingerprint as LIVE-CONTRACT-005 (RESOLVED), with the old wording kept and marked superseded. This closes the "known documentation inconsistency" of the Batch 5 closure.

### Chess rules: `assessMatingCapability`

- **API** (`@chess-one/chess-rules`):
  - `assessMatingCapability(position, matingColor, history?)` returns `"PROVEN_CAN_MATE" | "PROVEN_CANNOT_MATE" | "UNKNOWN"` (*superseded by Batch 6.1: the `history` parameter is removed*);
  - `findMatingWitness(position, matingColor, history?)` returns a verified line or `null` (*same*);
  - type `MatingCapability`.
- The question is existential and cooperative: can `matingColor` mate by any legal series of moves? It is not forced mate or an evaluation. It never reuses whole-position `PROVEN_DEAD` / `NOT_DEAD`.
- **Classes** (proofs in research section 9):
  - `PROVEN_CANNOT_MATE`: `matingColor` owns only its king, whatever the opponent owns. Also king and one bishop, or one knight, against a lone king. The proof is the geometric argument plus TST-RULE-CAP-004/005, which enumerate every placement of king and piece against a lone king in check; none is mate.
  - `PROVEN_CAN_MATE`: king and queen, king and rook, or king and two knights against a lone king, **only** when a verified witness line exists.
  - `UNKNOWN`: everything else. That includes any opponent material, other mating material, forced capture, stalemate, the 75-move boundary, and a history that does not end at the position. (*Superseded by Batch 6.1: the 75-move boundary and history no longer affect the answer.*)
- **Witness:** `mating-witness.ts` (package-internal) runs a deterministic best-first search, at most 1,500 expansions for each of 4 frames (2 corners by 2 orientations). It refuses king captures of the mating piece, halfmove 150, and positions whose history count would reach five. Every line is re-verified by `isVerifiedMatingLine`: legal moves, no terminal state or automatic draw before the end, and checkmate by `matingColor` at the end. (*Superseded by Batch 6.1: the halfmove, fivefold, and automatic-draw conditions are removed.*) The search is sound, not complete. No tablebase, retrograde analysis, engine, SAT solver, whole-chess brute force, or external library is used.
- **No material table.** Counterexample: White Kh1 Qb7 against Black Ka8 to move has only Kxb7, so the answer is `UNKNOWN`. Opponent blockers can enable mates (`kn6/1B6/1K6/8/8/8/8/8 b`), so any opponent material is `UNKNOWN`.
- Exports pass TST-FOUND-MATE-002 (no result, finish, adjudication, or termination names).

### Live game: timeout and resignation adjudication

- **Shared authority:** `adjudication.ts`, with `statusAfterFlag` and `statusAfterResignation`. Both evaluate `assessMatingCapability(position, opponent, state.history)` (*Batch 6.1: now `assessMatingCapability(position, opponent)`*):

| Capability of the opponent | Flag | Resignation |
|---|---|---|
| `PROVEN_CAN_MATE` | opponent wins, `terminationReason: "time"` | opponent wins, `"resignation"` |
| `PROVEN_CANNOT_MATE` | draw, `draw_rule`, `timeout_no_mate` | draw, `draw_rule`, `resign_no_mate_possible` |
| `UNKNOWN` | unresolved MATING_POSSIBILITY_UNRESOLVED, `flaggedSide` | unresolved, `resigningSide` |

- **Flag paths:** `flagTransition` is used by both the late-command branch and `processDeadline`. The flagged balance is 0 and the clock stops at the receipt or observation instant.
- **Events:**
  - A resolved flag or resignation emits exactly one `game.finished.v1`, in the committing decision. An unresolved stop emits none.
  - A command-caused finish carries command provenance `{command, seat, clientCommandId}`. A writer-deadline finish carries `{writerDeadline: true, flaggedSide}`, and `processDeadline(state, observedAt, auditWallClockMs = null)` stamps the optional audit time.
  - `DeadlineDecision` is now `{nextState, flagged, events}`.
- **Late command:** the response stays `MoveReceivedAfterDeadline` while `status` carries the adjudicated result. It is bound and committed once. An exact replay returns the original response with `replayedResponse: true`, the same state object, and no event.
- **`ResignGameCommand.v1`:** no move fields. The fingerprint is command version, `game_id`, and lease only. Processing order:
  1. shape;
  2. authority (seat, player, lease, `actor_id`);
  3. identity (replay, or `InvalidCommandIdentity`);
  4. finished guard (`GameAlreadyFinished`, non-binding) and unresolved guard;
  5. **no turn check**;
  6. sequence (`StaleSequence`, unbound);
  7. deadline;
  8. timely: the active side is charged to receipt, the clock stops, and the status comes from `statusAfterResignation`. The response is `Accepted` in all three outcomes, and the status tells which one.
- **Policy gap LIVE-RESIGN-001** (not stated by the documents, implemented narrowly for owner review; *RESOLVED in Batch 6.1*):
  - a resignation is accepted on either turn;
  - a resignation received after the active side's deadline is not a resignation. The flag fell first, so it is committed and adjudicated as a flag (`MoveReceivedAfterDeadline`, bound).
- **LIVE-CONTRACT-006 (OPEN; *RESOLVED in Batch 6.1 as `GameAlreadyFinished`*):** contract 10.4 and ledger 015a expect `InvalidState` for a resignation after a 5.2.2 finish. The implementation answers `GameAlreadyFinished` (non-binding, LIVE-CONTRACT-004). Nothing is applied either way.

### Structure

- `process-command.ts` went from 405 to 298 lines. The decision-assembly helpers moved to a new `decision.ts` (173 lines): the actor, ingress and decision types, `respond`, `reject`, `bound`, `bindRejection`, `commit`, `commitAndBind`, `boundCommitted`, and `finishEvents`. `process-command.ts` now owns command routing and the move, claim, resignation, and flag transitions. `adjudication.ts` (73 lines) owns the capability-to-status rule.
- `mating-witness.ts` (323 lines) is the largest source file. It is one cohesive search-and-verify unit.

### Documents

- **LIVE-CONTRACT-001 RESOLVED:**
  - `CONTRACT_CATALOG_V1.md` new 10.5, with 10.4's first bullet marked superseded;
  - `LIVE_GAME_EVENT_ORDERING_V1.md` section 3;
  - `CHESS_RULES_AUTHORITY_PACK_V1.md`, `TEST_ARCHITECTURE_AND_GATES_V1.md`, and `CHESS_RULES_GOLDEN_TEST_LEDGER_V1.md`, each with a later-correction note and the original text kept;
  - BR-038 in the v6 spec.
- **Research:** `MATING_POSSIBILITY_AND_DEAD_POSITION_RESEARCH_V1.md` new section 9 (predicate, classes, proofs, witness, asymmetric pair). GAP-MATE-004 is split into 004a (reviewed classes, RESOLVED) and 004b (general algorithm, OPEN). Section 4 (`PROVEN_DEAD`) is not widened. No claim of complete adjudication.
- **Changelog:** `PHASE_0_DECISION_CHANGELOG.md` section 14.
- **Traceability:** FR-GM-002, 003, and 009 extended. FR-P06-007 moved to PARTIAL.

### Golden rows 015 and 016

| Row | Status | Test |
|---|---|---|
| 015a | PARTIAL (*IMPLEMENTED in Batch 6.1*) | TST-LIVE-133. Nothing applied, no binding; the code is `GameAlreadyFinished`, not `InvalidState` (LIVE-CONTRACT-006) |
| 015b | IMPLEMENTED | TST-LIVE-130, under the corrected criterion (opponent `PROVEN_CAN_MATE`) |
| 015c | IMPLEMENTED | TST-LIVE-132 |
| 016a | IMPLEMENTED | TST-LIVE-120, under the corrected criterion; the whole-position detector never returns `NOT_DEAD` |
| 016b, 016c, 016e | IMPLEMENTED | unchanged; 016e is also covered by TST-LIVE-125 |
| 016d | IMPLEMENTED | TST-LIVE-122 (the flag result stands as a draw) and TST-LIVE-070 (unresolved) |

### Tests

- **Rules:**
  - TST-RULE-CAP-001 to 013 (unit);
  - CAP-020 to 023 (properties). CAP-023 covers colour-swap asymmetry and no mutation.
- **Live game:**
  - TST-LIVE-120 to 125, timeout, including the mandatory asymmetric pair (121) and flag replay (123);
  - TST-LIVE-130 to 139, resignation outcomes, idempotency, fingerprint, protections, and late resignation;
  - TST-LIVE-140 to 141, properties. They check the flag and resignation outcome against the capability, that UNKNOWN never yields a result, absorption, and no second event on replay, and they assert that both proven outcomes were exercised.
- **Updated for the approved behaviour change, not weakened:**
  - TST-LIVE-066 now uses positions whose opponent capability really is UNKNOWN; its K+Q positions resolve and are asserted in 120 and 121;
  - TST-LIVE-067 and 071 now expect `events: []` on `DeadlineDecision`;
  - the idempotency test's `Checkmated` fields are typed as `SubmitMoveCommandV1`.
- Perft (1/20/400/8902/197281, Kiwipete 48/2039/97862, position 3 14/191/2812/43238, position 4 6/264/9467), SAN, repetition, and draw tests are unchanged. The only diff under `tests/rules` against `d152afc` is `fixtures/ledger-status.ts`.

### Gates (Node 24.21.0, pnpm 12.7.0, TypeScript 7.0.2)

- typecheck, lint, format:check, check:boundaries, test, test:rules, check, and audit all pass (exit 0). Audit: no known vulnerabilities.
- 36 test files: 400 passed, 0 failed, 0 skipped, 3 todo (ledger rows 017a to 017c, draw offers).
  - rules: 291 passed and 3 todo;
  - boundaries: 24;
  - live-game: 85.
- Dependencies added: 0. `package.json`, `pnpm-lock.yaml`, and the package manifests are unchanged. No cast, `ts-ignore`, `ts-expect-error`, or `biome-ignore` was added.

### Remaining gaps

- GAP-MATE-004b: no general one-sided algorithm. Every position outside the reviewed classes is `UNKNOWN` and stays unresolved.
- GAP-MATE-001: the product policy for `UNKNOWN` is still undecided.
- LIVE-CONTRACT-006 (OPEN) and LIVE-RESIGN-001 (policy gap) need owner review. (*Both resolved in Batch 6.1.*)
- Draw offers and agreement, abort, persistence, outbox, transport, and reconnect are not built. (*Draw offers and agreement: built in Batch 7.*)

## PHASE 1 / BATCH 6.1 — MATING CAPABILITY SEMANTICS CORRECTION

Owner-directed correction after the independent Batch 6 review. Baseline `d152afc`. Batch 6 and 6.1 are uncommitted (*committed together as `0878d93` at the start of Batch 7*). No remote, no push. Batch 7 is not authorized. No change to move legality, SAN, repetition, the 50/75-move implementation, or dependencies.

### Root cause

The Batch 6 witness treated game-ending draw rules as part of the capability predicate. `searchFrame` skipped any child with `halfmoveClock >= 150` and any position whose history count would reach five. `isVerifiedMatingLine` rejected a line through `evaluateAutomaticDraws`, and the public API took the game's repetition history. Articles 5.1.2 and 6.9 ask whether a player can checkmate by any possible series of legal moves (Article 3.10.1, through Articles 3.1 to 3.9). Repetition and the seventy-five-move rule end an ongoing game; they do not decide whether such a series exists. Symptom: the same king-and-queen board with the lone king to move answered `PROVEN_CAN_MATE` at halfmove 0 but `UNKNOWN` at 149, so a flag there would have been left unresolved instead of lost.

### Fix

- **API:** `assessMatingCapability(position, matingColor)` and `findMatingWitness(position, matingColor)`. The `history` parameter is removed; passing one is now a type error.
- **Witness search:** no halfmove bound and no repetition count. Deduplication by placement, side to move, and rights is kept as a search optimization only.
- **Verification** (`isVerifiedMatingLine(position, matingColor, line)`):
  - every move is legal through `applyLegalMove`;
  - no position before the last is checkmate or stalemate (`evaluateMoveExhaustion`), so no move is played after either;
  - the last position is checkmate won by `matingColor`;
  - `repetitionCount`, `evaluateAutomaticDraws`, and the halfmove clock are not used.
- **Live game:** `statusAfterFlag(position, side)` and `statusAfterResignation(position, side)` no longer receive history. Both flag paths still share `flagTransition`. Timeout, replay, and event behaviour are unchanged.
- **Classes unchanged:**
  - only a king, and king and one bishop or one knight against a lone king: `PROVEN_CANNOT_MATE`;
  - king and queen, king and rook, king and two knights against a lone king: `PROVEN_CAN_MATE` only with a verified witness;
  - everything else: `UNKNOWN`.
- `mating-witness.ts` is now 308 lines (323 before).

### Regressions

- **TST-RULE-CAP-010, replaced.** The old test ("a line never runs past the seventy-five-move limit") encoded the wrong semantics. The new test: the same boards (king and queen with either side to move, and a black king and rook) at halfmove 0, 20, and 149 all answer `PROVEN_CAN_MATE`, and the witness from halfmove 149 replays to mate. **Red before the fix:** halfmove 149 gave `UNKNOWN`.
- **TST-RULE-CAP-011, replaced.** The old stale-history test was removed with the parameter. The new test reaches the same king-and-queen position through repetition cycles up to its 6th occurrence, past fivefold, and gets the same answers (White `PROVEN_CAN_MATE`, Black `PROVEN_CANNOT_MATE`) and the same witness as the fresh position.
- **TST-LIVE-126, new.** A game whose history holds the current position four times, and a game at halfmove 149, both adjudicate a Black flag as a White win on time, like a fresh game. The halfmove-149 case gave MATING_POSSIBILITY_UNRESOLVED before the fix.
- **TST-RULE-CAP-023** no longer passes a history; the no-mutation check on the position remains.
- The 75-move and fivefold tests in draw rules and the live game are unchanged.

### Owner decisions recorded

- **LIVE-CONTRACT-006 RESOLVED:** a new resignation after the game has finished is `GameAlreadyFinished`, non-binding. The `InvalidState` wording in `CONTRACT_CATALOG_V1.md` 10.4 and ledger row 015a is marked SUPERSEDED. Row 015a is now IMPLEMENTED (TST-LIVE-133), and its `resign_no_mate_possible` note is covered by TST-LIVE-131.
- **LIVE-RESIGN-001 RESOLVED:** a player may resign on either turn. `received_at <= active-side deadline` means the resignation is processed; later means the flag came first and is adjudicated. Contract 10.5. TST-LIVE-139 covers both seats on both sides of the deadline; TST-LIVE-130 covers the opponent's turn.
- **GAP-MATE-004b stays OPEN.** The search is bounded and incomplete, and `UNKNOWN` remains required.

### Documents

- `CONTRACT_CATALOG_V1.md` 10.4 and 10.5;
- `CHESS_RULES_GOLDEN_TEST_LEDGER_V1.md` correction note;
- `MATING_POSSIBILITY_AND_DEAD_POSITION_RESEARCH_V1.md` sections 9.1 to 9.4, with the Batch 6 wording marked superseded;
- `PHASE_0_DECISION_CHANGELOG.md` section 15;
- `TRACEABILITY_MATRIX_V2.md` summary and FR-P06-007 (no status change);
- the v6 status line;
- superseded markers in the Batch 6 section above.

### Gates (Node 24.21.0, pnpm 12.7.0)

- typecheck, lint, format:check, check:boundaries, test, test:rules, check, and audit all pass (exit 0). Audit: no known vulnerabilities.
- 36 files: 401 passed, 0 failed, 0 skipped, 3 todo.
  - rules: 291 passed and 3 todo;
  - boundaries: 24;
  - live-game: 86.
- Perft, SAN, repetition, and draw-rule tests are unchanged.
- Dependencies added: 0. No cast or suppression was added.

## PHASE 1 / BATCH 7 — DRAW OFFER STATE MACHINE — LIVE GAME CORE COMPLETION

Owner-authorized after the Batch 6 and 6.1 reviews passed. Batch 8 is not authorized. This batch builds no PostgreSQL, Kysely, persistence, outbox, Fastify, WebSocket, reconnect transport, matchmaking, rating, web UI, tournament, AI, draw-offer chat or UI, or abort policy.

### Stage A: commit of Batch 6 and 6.1

- Baseline check before the commit: `pnpm check` 401 passed, 0 failed, 0 skipped, 3 todo; `pnpm audit` no known vulnerabilities.
- Commit `0878d9368d7096a344fb1eef9bf9c7664ba9b1c1` (`0878d93`), "feat: add one-sided mating adjudication". Parent `d152afc`. 32 files: the 22 modified and 10 new Batch 6 and 6.1 files.
- Excluded, verified: review ZIPs (ignored by `CHESS_ONE_*_REVIEW*.zip`), `node_modules`, build output, secrets. A scan of the committed files found only prose mentions of "secret". Git config unchanged. No remote, no push.
- Batch 7 is uncommitted.

### Model

- `ActiveGameState.pendingDrawOffer: PendingDrawOffer | null`, with `PendingDrawOffer = { offeredBy, offeredTo, createdAtSequence }`, frozen. No text, wall clock, label, notification, or timestamp. `createActiveGame` starts with `null`.
- `createdAtSequence` is the game sequence of the transition that committed the offer. It is also the server `offer_id` of contract 10.3 (LIVE-OFFER-001): each sequence is committed once, so no generated id is needed.
- "Both players have moved" comes from committed history, not from `sequence`: only a committed move appends a repetition key, so `history.length - 1` counts moves since the start position. Moves alternate, so two moves mean each side has moved, and the seat not to move made the last move. No new state field and no PGN.
- Invariant: an offer exists only while the status is `active`, and it always belongs to the seat not to move (`offeredTo` is the side to move). `commit` in `decision.ts` clears the offer whenever the committed status is not `active`. `playMove` clears it on every committed move.

### Commands

- `OfferDrawCommand.v1`: envelope fields only. `RespondDrawOfferCommand.v1`: `offerId` (a non-negative integer, else `malformed_offer_id`) and `decision` (exactly `accept` or `decline`, else `unknown_draw_offer_decision`). Shape errors are unbound `InvalidState`.
- Both pass the full contract 2.3 order: shape, trusted actor (game, player, seat, lease, `actor_id` echo), identity and replay, finished and unresolved guards, sequence, deadline. They skip the generic `NotYourTurn` check, like a resignation, because each has its own seat rule.
- **Offer** (contract 10.2, article 5.2.3), in this order:
  1. an offer already pending: `InvalidState` `draw_offer_already_pending`. This applies to either seat; the recipient's offer is not an acceptance;
  2. fewer than two committed moves, or the offerer is the side to move: `InvalidState` `draw_offer_not_allowed`;
  3. otherwise: `Accepted`. The sequence goes up by one, the offer is stored, and the binding is stored. The clock object, position, history, and status are unchanged, and no event is emitted.
- **Response** (contract 10.3), in this order:
  1. no pending offer: `InvalidState` `no_pending_draw_offer`;
  2. the responder is not `offeredTo`, for example the offerer: `InvalidState` `not_draw_offer_recipient`;
  3. `offerId` does not match: `InvalidState` `draw_offer_id_mismatch`;
  4. `accept`: status `finished` with `{ resultCode: "draw", terminationReason: "draw_agreed" }` (a new `GameResult` variant with no draw-rule detail, contract section 5). The recipient is charged to receipt, the clock stops, the offer clears, the sequence goes up by one, one `game.finished.v1` is emitted with the response command's provenance, and the binding is stored;
  5. `decline`: the offer clears. The sequence goes up by one and the binding is stored. The clock object, position, history, and status are unchanged, and no event is emitted.
- Out-of-rule offers and responses are bound, like `IllegalMove`, so a retry replays the same answer (LIVE-OFFER-002). No new `ResponseCode`: the contract says `InvalidState`, and the detail makes each cause specific.

### Interactions

| Situation while an offer is pending | Result |
|---|---|
| Recipient's legal move | Applied and judged on its own (checkmate stays checkmate). The offer clears in the same transition: one sequence step, no extra event or command (row 017c) |
| Recipient's illegal move | `IllegalMove`, bound. The offer stays |
| Unauthorized, StaleSequence, InvalidState, InvalidCommandIdentity, NotYourTurn, a mismatched response, the offerer's response | Nothing committed. The offer stays (the same object) |
| Correct claim | Finished by the claim. The offer clears |
| Incorrect current claim | Penalty committed, no move. The offer stays |
| Incorrect intended claim with a legal move | Penalty and move in one transition. The offer clears |
| Incorrect intended claim with an illegal move | Penalty committed, no move (`IllegalMove`). The offer stays |
| Resignation by either seat | The resignation decides: a win, `resign_no_mate_possible`, or unresolved. It never becomes `draw_agreed`. The offer clears, including when unresolved (UNKNOWN) |
| Flag (writer deadline or late command) | The flag decides. The offer clears, resolved or unresolved. A later response is `GameAlreadyFinished` or the unresolved code |
| Offer or response received after the deadline | Not applied; the flag is committed (`MoveReceivedAfterDeadline`). A late acceptance creates no draw (LIVE-OFFER-003) |
| After the game finished | A new offer or response is `GameAlreadyFinished`, unbound, same state object. Stored bindings still replay first |

### Identity

- Offer fingerprint: `OfferDrawCommand.v1 <game_id> <control_lease_id>`.
- Response fingerprint: `RespondDrawOfferCommand.v1 <game_id> <control_lease_id> <offer_id> <decision>`. The contract lists `offer_id` as a required semantic field, so it is part of the fingerprint.
- Excluded: client time, `actor_id`, `expected_game_sequence`, and UI metadata. `client_command_id` is the lookup key with the seat.
- An exact replay returns the stored response with `replayedResponse: true` and the same state object, and adds no sequence or event. The same id with another command (for example `decline` then `accept`) is `InvalidCommandIdentity`.

### Structure

- New `server/live-game/src/draw-offer.ts` (79 lines): `offerDraw` and `respondDrawOffer`.
- `process-command.ts` 298 to 318 lines: dispatch by `switch`, the narrower turn check, and doc comments. `commands.ts` 203, `active-game.ts` 180, `decision.ts` 178. `mating-witness.ts` (308) is unchanged.
- No unrelated refactor.

### Golden rows 017a to 017c

| Row | Status | Test |
|---|---|---|
| 017a | IMPLEMENTED | TST-LIVE-150: no seat may offer before any move, or after one move; `InvalidState`, no offer |
| 017b | IMPLEMENTED | TST-LIVE-155: after each side has moved, offer then accept ends `draw_agreed`, with one event and no event on replay |
| 017c | IMPLEMENTED | TST-LIVE-160 (the legal move declines in the same transition) and TST-LIVE-161 (a mating reply is checkmate, not a draw) |

No ledger row is NOT_IMPLEMENTED any more, so the todo count is 0. `ledger-status.test.ts` still reports any future NOT_IMPLEMENTED row as todo. It now registers that suite only when such a row exists, because Vitest fails an empty suite. The `notImplemented` helper in `fixtures/ledger-status.ts` was unused and was removed; the `NOT_IMPLEMENTED` status type is kept.

### Tests

- `tests/live-game/draw-offer.test.ts`, TST-LIVE-150 to 175:
  - timing (150, 151);
  - pending state (152);
  - a second offer from either seat (153);
  - late offer (154);
  - accept (155);
  - the offerer's response (156);
  - decline with replay (157);
  - no pending offer or a mismatched id (158);
  - malformed responses (159);
  - legal and mating moves (160, 161);
  - illegal move (162);
  - every non-committing rejection (163);
  - claims (164 to 167);
  - resignation, resolved and UNKNOWN (168, 169);
  - flag, resolved and unresolved, with late and on-time acceptance (170, 171);
  - post-terminal commands and replays (172);
  - offer replay (173);
  - identity conflicts (174);
  - fingerprints (175).
- `tests/live-game/draw-offer.property.test.ts`, TST-LIVE-180. It runs 100 seeded random sessions of 10 to 40 steps: moves, random squares, offers, responses, claims, stale commands, replays, resignations, and writer deadline checks. It checks the invariants below and asserts that each named scenario was reached.
  - A: at most one offer, never replaced, and always owned by the seat not to move.
  - B: no offer once the game has stopped.
  - C: an acceptance is `draw_agreed` with exactly one event.
  - D: a replay returns the same state.
  - E: nothing uncommitted clears the offer.
  - F: a committed move clears it.
  - G: an illegal move keeps it.
  - H: an offer or response never changes the position or history.
- Mutation checks, reverted:
  - removing both clears (in `playMove` and on stop in `commit`) failed 9 unit tests: TST-LIVE-155, 160, 161, 164, 166, and 168 to 171;
  - removing only the `playMove` clear failed the property test on its first run.
- The harness gained `offerCommand` and `respondCommand`, and `snapshot` now includes `pendingDrawOffer`. No existing test expectation changed. The only change to an existing test is the conditional todo suite in `ledger-status.test.ts`, described above.

### Documents

- v6 current execution-status block: Batches 1 to 6.1 passed, Batch 6 committed, Batch 7 in progress, Batch 8 not authorized, GAP-MATE-004b open.
- `CONTRACT_CATALOG_V1.md` section 10 later-status note. There is no normative change and no conflict.
- `PHASE_0_DECISION_CHANGELOG.md` section 16 (LIVE-OFFER-001 to 006, pending review).
- `TRACEABILITY_MATRIX_V2.md`: summary, FR-GM-003, FR-GM-009, FR-P06-005 later-status note, and FR-P06-007. No status change.

### Final live-game core review

- Commands decided: `SubmitMoveCommand.v1`, `ClaimDrawCommand.v1`, `ResignGameCommand.v1`, `OfferDrawCommand.v1`, and `RespondDrawOfferCommand.v1`. These are all the live-game commands named in `CONTRACT_CATALOG_V1.md`. There is also the writer's own deadline check (`processDeadline`).
- Remaining categories, none of them a command contract yet:
  - reconnect and sync (contract section 3);
  - control-lease replacement (DEC-043; only a test seam exists);
  - abort, no-start, and abandonment (`aborted` and `abandonment` result codes exist in section 5, with no approved policy);
  - `game.move_accepted.v1` and other non-final events;
  - the outbox and `event_id`;
  - persistence and recovery;
  - trusted ingress stamping;
  - binding retention.
- Readiness for persistence: the decision core is ready to be wrapped. Every decision is a pure function of state, trusted actor, command, and ingress time. Each committed transition moves the sequence by exactly one. Bindings and the one `game.finished.v1` are produced in the same returned state as the change they belong to. That maps onto one database transaction with an outbox row. Decisions a persistence batch has to make first:
  - a serialized form for `Position`, `RepetitionKey` history, and bindings;
  - binding retention;
  - `event_id` assignment;
  - the product policy for unresolved games (GAP-MATE-001).
  Persistence is not started.

### Gates (Node 24.21.0, pnpm 12.7.0, TypeScript 7.0.2)

- typecheck, lint, format:check, check:boundaries, test, test:rules, check, and audit all pass (exit 0). Audit: no known vulnerabilities.
- 38 test files: 428 passed, 0 failed, 0 skipped, 0 todo.
  - rules: 291;
  - boundaries: 24;
  - live-game: 113.
- Dependencies added: 0. `package.json`, `pnpm-lock.yaml`, and the package manifests are unchanged. No cast, `ts-ignore`, `ts-expect-error`, or `biome-ignore` was added. No `Date`, `performance`, randomness, `process`, filesystem, network, timers, `eval`, or `Function` in live-game source.

### Remaining gaps

- GAP-MATE-004b (general one-sided algorithm) and GAP-MATE-001 (product policy for `UNKNOWN`) stay open.
- LIVE-OFFER-001 to 006 await owner review. LIVE-OFFER-006 needs a product decision on repeated offers. (*All resolved at the Batch 7 closure below.*)
- Abort, abandonment, reconnect, lease replacement, persistence, the outbox, and transport are not built. (*Persistence and the outbox: Batch 8 below.*)

## PHASE 1 / BATCH 7 CLOSURE — LIVE-OFFER-006 RESOLVED

Batch 7 passed review. The owner approved the repeated-offer policy: **one draw offer per committed move**.

- **State:** `ActiveGameState.lastDrawOfferMove: number | null`, the committed move count (`history.length - 1`) that the last accepted offer was based on. `createActiveGame` sets `null`. Only an accepted offer writes it. A decline, a move, a claim, or a stop never resets it; a later move simply makes the count differ. It is derived from committed moves, not from `sequence`, which non-move commands also advance. No offer history is kept.
- **Rule:** after the timing check, an offer whose move count equals `lastDrawOfferMove` is `InvalidState` with detail `draw_offer_already_used_for_move`, bound like the other offer rejections. There is no time cooldown, quota, or timer.
- **Tests:**
  - TST-LIVE-176: offer, decline, then an immediate repeat is rejected, and the marker survives;
  - TST-LIVE-177: after the recipient's move, only the new last mover may offer;
  - TST-LIVE-178: the original offerer may offer again after another move of their own, and that offer can be accepted;
  - TST-LIVE-179: the original offer still replays after the decline, and acceptance and terminal behaviour are unchanged;
  - TST-LIVE-158 was updated to the new policy: the re-offer now follows two moves, with `offer_id` 7 instead of 5;
  - the property test TST-LIVE-180 now also checks that only an offer changes the marker, that an offer is never accepted twice on the same move count, and that the new rejection is reached.
- **Mutation check:** disabling the marker check fails TST-LIVE-176 and TST-LIVE-180 (reverted).
- **Documents:**
  - `CONTRACT_CATALOG_V1.md` 10.2, a later-approved policy paragraph;
  - `PHASE_0_DECISION_CHANGELOG.md` section 16, LIVE-OFFER-006 RESOLVED with the old wording kept as superseded;
  - the v6 status.
  Traceability is unchanged: the policy is not material to any row's status.
- **Gates:** see the Batch 7 commit record in the Batch 8 section.

## PHASE 1 / BATCH 8 — PERSISTENCE FOUNDATION (POSTGRESQL + KYSELY + TRANSACTIONS + OUTBOX)

Owner-authorized (2026-09-28). Implemented, **uncommitted**, awaiting review. No remote, no push, no review ZIP.

### Batch 7 commit record

- Commit `bee3f128d9b4239f7bcb4a753e272b502f61be8d` ("feat: complete live game draw offers"), 18 files, local only.
- Gates before the commit: typecheck, lint, format:check, check:boundaries, test, test:rules, check, and audit all passed (exit 0). 38 test files, 432 passed, 0 failed, 0 skipped, 0 todo (rules 291, boundaries 24, live-game 117). Working tree clean afterwards.

### Environment

- Checked on this machine: no `psql`, `postgres`, `pg_ctl`, `initdb`, `docker`, or `podman`; WSL not installed; nothing listening on port 5432.
- Nothing was installed (no system software, no Docker), and no shared, cloud, or Supabase database was used.
- **The PostgreSQL integration tests are therefore BLOCKED by the environment.** `pnpm test:db` runs them and fails all 9 with a BLOCKED message; they never skip.
- *Later status (Batch 8.1):* a local PostgreSQL 18.6 test server was installed with owner authorization, and the suite passes; see the Batch 8.1 section.

### Dependencies (exact versions, reviewed before install)

- `kysely` 0.29.6 (MIT, stable, no dependencies) and `pg` 8.23.0 (MIT), production dependencies of `@chess-one/live-game-persistence`; `@types/pg` 8.23.1 (MIT) as a dev dependency. The test package adds `kysely` and `pg` as dev dependencies.
- Transitive, all from `pg`: `pg-pool` 3.14.0, `pg-protocol` 1.16.0, `pg-types` 2.2.0, `pg-connection-string` 2.14.0, `pg-cloudflare` 1.4.0 (optional), `pgpass` 1.0.5, `split2` 4.2.0 (ISC), `pg-int8` 1.0.1 (ISC), `postgres-array` 2.0.0, `postgres-bytea` 1.0.1, `postgres-date` 1.0.7, `postgres-interval` 1.2.0, `xtend` 4.0.2. All others MIT.
- 16 new lockfile packages, each with a `sha512` integrity hash. None has an install script. `pnpm audit`: no known vulnerabilities.
- No ORM other than Kysely, no beta or release-candidate version, no broker, no telemetry or logging library.

### Architecture

- **Live Game owns the contracts** (`server/live-game/src/persistence/`, pure, same boundary policy as the core: no Kysely, pg, I/O, clock, or environment):
  - `state-codec.ts`: the `live_game_state.v1` format and `decodeGameState`;
  - `response-codec.ts`: stored responses, and the plain `game.finished.v1` payload;
  - `value-codec.ts`: clock, result, and status;
  - `records.ts`: strict readers;
  - `repository.ts`: the `LiveGameRepository` port, its error kinds, `ClockDomainId`, `EventId`, and `planCommit`;
  - `writer.ts`: `startGame`, `executeCommand`, and `executeDeadline`.
- **`processCommand` is unchanged and database-free.** The writer loads, decides with the pure core, plans, and commits.
- **Adapter** (`server/live-game-persistence`): `PostgresLiveGameRepository`, `createLiveGameDatabase` (a pg pool from host-supplied settings; it never reads the environment), and `SqlFileMigrationProvider` with numbered SQL files.
- chess-rules and game-values are untouched: no database types in the domain.

### Serialization: `live_game_state.v1`

- One explicit, versioned format. Encoding copies each field into plain data; no domain object is stored as is.
- **Position:** canonical FEN (`formatFen`). On load it must parse and format back to the same text.
- **Repetition history:** the canonical repetition-key text of every committed position, never derived from a FEN. On load each key is rebuilt into a position, which must parse, and `repetitionKey` of that position must give the same text; the key object comes from `repetitionKey`, its only constructor. Consecutive keys must alternate sides, and the last key must equal the current position's key.
- **Fail closed:** decoding rebuilds values through validated constructors and checks the invariants the core relies on, for example:
  - an active game has a running clock owned by the side to move, and no terminal facts;
  - a stopped game has a stopped clock;
  - a checkmate result is mate on the board;
  - a pending offer is on an active game, addressed to the side to move, on the current committed move;
  - bindings are contiguous and unique, and belong to this game.
  Any failure is `corrupt_state` with a field path. Nothing is repaired or defaulted, and reasons never repeat stored values (control-lease ids).
- `pendingDrawOffer` and `lastDrawOfferMove` are persisted.

### Schema (migrations 001 to 003)

- `live_games`:
  - primary key `game_id`;
  - typed columns `state_format`, `ruleset_id`, player ids, `sequence`, `status_kind`, `position_fen`, and `clock_domain_id`;
  - the `state` JSONB record;
  - audit `created_at` and `updated_at`;
  - checks tying the JSONB record to the columns, and allowing an offer only on an active game.
- `live_game_command_bindings`:
  - primary key `(game_id, seat, client_command_id)` and `UNIQUE (game_id, binding_ordinal)`;
  - fingerprint, `bound_at_sequence`, and the original response as JSONB;
  - foreign key to the game, `ON DELETE RESTRICT`.
- `outbox_events`:
  - primary key `event_id uuid DEFAULT gen_random_uuid()`;
  - type and version, aggregate type, id, and sequence, and the JSONB payload;
  - `created_at`, `publication_status` (`pending` or `published`), and `published_at`, with a consistency check;
  - `UNIQUE (aggregate_type, aggregate_id, aggregate_sequence, event_type)`;
  - partial index `outbox_events_pending_idx` on `(created_at, event_id)` for pending rows.
- JSONB only for the aggregate record, the stored response, and the event payload. Every down migration drops its own table. Kysely's migration bookkeeping lives in `live_game_schema_migrations` and `live_game_schema_migration_lock`.
- On load, the adapter checks the typed columns against the decoded record; a mismatch is corruption.

### Transactions and concurrency

- **Load:** one `REPEATABLE READ, READ ONLY` transaction reads the game row and its bindings in ordinal order.
- **Commit:** one transaction:
  - `UPDATE live_games ... WHERE game_id = $1 AND sequence = $expected`, where any row count other than 1 is `concurrency_conflict`;
  - then the binding insert;
  - then the outbox inserts, `RETURNING event_id`.
  A bind-only rejection still runs the compare-and-set update (audit time only), so it holds the row lock and proves its sequence.
- Any error rolls everything back. SQLSTATE `23505`, `40001`, and `40P01` are `concurrency_conflict`; others are `persistence_failure` with the SQLSTATE only, never a message.
- Nothing is published inside the transaction. The writer does not retry a conflict: the caller reloads and resubmits, and the stored binding replays any decision that won.
- Every statement is built by Kysely with bound parameters; the only raw SQL is the fixed migration text.

### `planCommit`

- It maps a decision to no write, `bind_only`, or `transition`.
- The core appends at most one binding and moves the sequence by at most one. Any other change is a defect and is thrown, never persisted:
  - stored bindings changed;
  - two bindings appended;
  - a sequence jump;
  - a field change without a sequence step, compared over every own field;
  - a game identity change;
  - events without a transition.

### Clock recovery: LIVE-RECOVERY-CLOCK-001 (OPEN)

- The existing architecture does not decide how much time a running clock used between a writer's last commit and a restart. Monotonic instants never cross processes (DEC-063).
- Each commit therefore stores the writer's `clock_domain_id`. A writer in another domain does not resume a running clock:
  - it replays stored bindings unchanged, because identity is decided before any clock field is read;
  - it refuses every other command and deadline check with `clock_recovery_blocked`, writing nothing.
- Finished and unresolved games never read the clock again and are served normally. Owner decision needed (changelog section 17).
- *Later status (Batch 8.1):* RESOLVED by the owner: the game is recovery-paused at its committed balances. `clock_recovery_blocked` is replaced by `recovery_paused`; see the Batch 8.1 section.

### LIVE-CONTRACT-003 (RESOLVED)

- `event_id` is assigned at the persistence boundary by PostgreSQL, stored once, and returned to the writer.
- `occurred_at` for the future envelope is the outbox `created_at`, the database time of the commit transaction.
- Details are in changelog section 17.

### Boundaries

- A new policy for `server/live-game-persistence/src/`. It may import only game-values, chess-rules, live-game, `kysely`, `kysely/migration`, `pg`, `node:fs/promises`, and `node:path`, and it keeps the ambient ban (no environment, clock, console, or timers). Its manifest may list only those packages.
- The live-game core, chess-rules, and game-values still cannot import Kysely, pg, or the adapter.
- A new rule, `client_imports_persistence`: `clients/` may not import or depend on `kysely`, `pg`, `pg-*`, or the adapter.
- Root `typecheck` and `check` include `tsc -p server/live-game-persistence`.
- `test:db` runs the integration suite through `vitest.db.config.ts`; the default `test` excludes `*.db.test.ts`.

### Tests

- `tests/live-game-persistence`, 5 files, 47 tests.
- The repository double and the recording driver are labelled as not PostgreSQL, and no PostgreSQL behaviour is claimed from them.
- **Codec (TST-PERSIST-001 to 006, 010 to 021):**
  - round trips for a new game, active with bindings, pending offer, declined offer (marker), checkmate, draw agreed, and unresolved flag;
  - decoded states decide the next commands like the originals;
  - bindings replay after decode;
  - `UNKNOWN` never gains a result;
  - corruption: format and version, missing and extra fields, invalid and non-canonical FEN, mismatched and non-canonical repetition keys, negative or fractional clock values, invalid sequences, malformed results, invalid leases and ids, impossible enums and status combinations, impossible offer state, malformed bindings and responses, binding order and duplicates;
  - a property test, 400 runs, seed 20260928: a mutated record either decodes to exactly the same record or is refused.
- **Planning (TST-PERSIST-040 to 044).**
- **Writer, with a contract double that stores only JSON text (TST-PERSIST-050 to 058):**
  - start and duplicate start;
  - the stored state equals the pure core's;
  - no write for non-binding rejections, and a bind-only write for bound ones;
  - replay after restart, with LIVE-RECOVERY-CLOCK-001 blocking new decisions;
  - one outbox event across a finish and a restart;
  - a concurrency conflict;
  - the writer's flag with its event;
  - corrupt and missing games.
- **Adapter protocol, with a recording Kysely driver (TST-PERSIST-060 to 069):**
  - the exact SQL and bound parameters, with no literal data in SQL text;
  - transaction settings, and the column cross-checks;
  - rollback at the state update, binding insert, and outbox insert;
  - compare-and-set misses;
  - SQLSTATE mapping without message leaks.
- **Migrations, static (TST-PERSIST-070 to 074):**
  - exactly three tables, in dependency order;
  - reversible downs;
  - keys, uniqueness, and the pending index;
  - the pinned format;
  - misnamed or orphan files refused.
- **Boundaries:** TST-BOUNDARY-025 to 028 and an extended TST-BOUNDARY-024. TST-LIVE-095 and 096 now also scan `src/persistence/` and the adapter.
- **PostgreSQL integration (`postgres.db.test.ts`, 9 tests, TST-PERSIST-DB-001 to 009), BLOCKED here:**
  - migrations on PostgreSQL 18, then down and up again;
  - constraints;
  - replay after restart (§31);
  - finish-event restart (§32);
  - failure injection with test-only triggers at the state update, binding insert, and outbox insert (§33);
  - a real two-writer race;
  - outbox uniqueness;
  - JSONB corruption;
  - index use.
  They need `CHESS_ONE_TEST_DATABASE_URL` pointing at a local database whose name ends in `_test`. Each test runs in its own schema, dropped afterwards.
- Mutation checks were not run in this batch: the attempted run was blocked by the session's command review and the mutation was reverted immediately.

### Gates (Node 24.21.0, pnpm 12.7.0, TypeScript 7.0.2)

- typecheck, lint, format:check, check:boundaries, test, test:rules, check, and audit all pass (exit 0). Audit: no known vulnerabilities.
- 43 test files: 483 passed, 0 failed, 0 skipped, 0 todo.
  - rules: 291;
  - boundaries: 28;
  - live-game: 117;
  - persistence: 47.
- `test:db`: 1 file, 9 tests, 9 failed as BLOCKED by the environment (no database). Not counted as passing.
- No cast, `ts-ignore`, `ts-expect-error`, or `biome-ignore` was added. No `Date`, `performance`, randomness, `process`, filesystem, network, timers, `eval`, or `Function` in live-game or adapter source.

### Retention, observability, performance

- Bindings and outbox rows are kept for the life of the game: no TTL, no deletion path. Archive and retention policy is TBD.
- No telemetry or logging library. Errors carry kinds, field paths, and SQLSTATEs only.
- Every statement addresses one game by primary key, the binding key, or the pending-outbox index; there is no table scan in the runtime path.

### Remaining gaps

- The PostgreSQL integration tests must be run on a local PostgreSQL 18 test database before any PostgreSQL correctness claim.
- LIVE-RECOVERY-CLOCK-001 needs an owner decision; until then, a running game cannot continue after a writer restart.
- No outbox dispatcher or publication, and no envelope assembly.
- Retention and archive policy is TBD.
- Every command loads all of the game's bindings (one indexed read per game); a single-binding lookup is a possible later optimization.
- The host owns pool lifecycle and pg idle-client error handling.
- No transport, reconnect, lease replacement, abort, or abandonment.
- *Later status (Batch 8.1):* the first two gaps are closed: the integration tests pass on PostgreSQL 18.6, and LIVE-RECOVERY-CLOCK-001 is resolved. The rest remain.

## PHASE 1 / BATCH 8.1 — REAL POSTGRESQL VERIFICATION + CRASH CLOCK RECOVERY POLICY

Owner-authorized (2026-09-29). Implemented, **uncommitted** together with Batch 8, awaiting review. `HEAD` stays `bee3f128d9b4239f7bcb4a753e272b502f61be8d`. No remote, no push. Batch 9 is not started.

### Owner decision: LIVE-RECOVERY-CLOCK-001 RESOLVED

- **Pause on writer clock-domain loss; preserve committed balances; no player is charged for server/process downtime.**
- `server/live-game/src/persistence/writer.ts`:
  - `gameCondition(stored, clockDomainId)` gives one of four conditions:
    - `running`: active, with the clock running in this writer's domain;
    - `finished`;
    - `rules_unresolved`;
    - `recovery_paused`, with reason `RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED`, the last committed balances, the active side, and the stored clock domain.
  - `loadForWriter` loads a game with its condition; loading never writes.
  - `executeCommand` on a paused game replays a stored binding unchanged and refuses every other command with the pause. `executeDeadline` refuses with the pause. Neither writes.
- The pause is not a `GameStatus`, not `MATING_POSSIBILITY_UNRESOLVED`, and has no `GameResult`. It is derived from durable columns (a running clock and another `clock_domain_id`), so it needs no write, no sequence step, and no event.
- Nothing compares the stored monotonic anchor with the new writer's clock, and wall clock never measures downtime. DEC-063 and the same-domain path are unchanged.
- **LIVE-RECOVERY-RESUME-001 (OPEN):** the reconnect/resume operation that ends a pause and re-anchors the clock in the new domain is deferred to the realtime/reconnect phase. It is not implemented, so a paused game stays paused.

### Local PostgreSQL (development and test only)

- **Version:** PostgreSQL 18.6, the current 18.x minor according to postgresql.org's versioning page on 2026-09-29. It is a stable release, not an RC, beta, or nightly build.
- **Source:** EDB, the Windows distribution linked from postgresql.org/download/windows.
  - The installer `postgresql-18.6-1-windows-x64.exe` (SHA-256 `CAE561E98D09F3F4A1A95759249240F86F66D71DCF33D14B6F7BE894078401D1`) has a valid Authenticode signature: signer EnterpriseDB Corporation, issued by DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1, with a DigiCert timestamp.
  - It was run only in `--extract-only` mode, without pgAdmin or StackBuilder. That mode creates no cluster, Windows service, registry entry, or firewall rule.
  - EDB's zip archive was also compared: all 69 `bin` and 146 `lib` files are byte-identical to the signed installer's. The zip itself is not used.
- **Location:** user profile only, outside the repository (`%LOCALAPPDATA%\chess-one-dev`), for the binaries, the data directory, and the local secrets.
- **Server:** started with `pg_ctl` as a user process, not a service. `listen_addresses = 'localhost'` and port 5432, so it listens on `127.0.0.1` and `::1` only. `pg_hba.conf` allows SCRAM-SHA-256 from loopback only. No firewall rule was added.
- **Roles:**
  - The cluster superuser `chess_one_admin` has a random password kept in the user profile.
  - The test role `chess_one_test` has LOGIN only: NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, NOINHERIT. It owns the database `chess_one_test`, so it can create and drop its own schemas there.
  - PUBLIC's CONNECT and TEMPORARY rights on `postgres` and `template1` were revoked, so the test role cannot connect elsewhere.
- **Credentials:** `CHESS_ONE_TEST_DATABASE_URL` is set as a Windows user environment variable. No password or URL is in the repository, and `.env` stays ignored.
- **No application dependency was added.** Docker, Podman, WSL, cloud database software, Supabase, and production services were not installed.

### Integration tests (`tests/live-game-persistence/postgres.db.test.ts`, 12 tests)

- **Guards:** the URL must name a local host and a database ending in `_test`. Before every destructive setup or cleanup statement, the server's `current_database()` must end in `_test` and the schema must match the suite's generated pattern; otherwise the suite fails closed. It only drops its own schemas and never drops a database. A missing URL fails as BLOCKED, never as a skip.
- **Verification reads:** "unchanged" is checked through a new connection pool, comparing every stored row, including `updated_at`.
- **Genuine races:** a third connection holds an EXCLUSIVE lock on `live_games` until PostgreSQL reports every contender waiting on it, so the contending transactions really overlap.
- **Tests:**
  - DB-001: migrations from an empty schema to latest on PostgreSQL 18. Checks every table, all 30 named constraints, all 6 indexes (including the partial pending index), the `gen_random_uuid()` default, and the bookkeeping rows. Then down (tables and bookkeeping emptied), up again, an idle re-run, and a usable schema.
  - DB-002: constraints refuse impossible rows: a bad format, a column/record mismatch, an orphan binding, and an inconsistent publication; a duplicate game is refused.
  - DB-003: restart replay under both a new and the same clock domain: the original response with `replayedResponse: true`, and identical rows (same sequence, no new binding, no outbox row).
  - DB-004: checkmate restart: one `game.finished` row with a v4 UUID `event_id` equal to the returned one. A retried commit of the same decision is a concurrency conflict, and replay after restarts in both domains leaves exactly one row.
  - DB-005: an injected failure at the state update, the binding insert, and the outbox insert each rolls back everything.
  - DB-006: two connections load sequence 0 and commit concurrently: exactly one wins, the other gets `concurrency_conflict`, and only the winner's state and binding are stored.
  - DB-007: a duplicate outbox event is refused by `outbox_events_once_per_aggregate_sequence`; 1000 default ids are non-null, distinct, v4 UUIDs.
  - DB-008: corruption fails closed.
  - DB-009: index use.
  - DB-010: concurrent bind-only commits of the same command, and of two commands at the same ordinal, store exactly one binding; the database rejects the loser. Direct inserts are refused by `live_game_command_bindings_pkey` and `live_game_command_bindings_ordinal_key`.
  - DB-011: a running game stored under domain A is recovery-paused under B. Its committed balances are unchanged, and new moves are refused, whether received at an instant before the old anchor, just after it, or far beyond any deadline. Resignation, draw offer, and deadline are refused too. Stored commands replay. Every row, including `clock_domain_id` and `updated_at`, is unchanged. Back under A, the game runs and charges only same-domain time.
  - DB-012: finished and rules-unresolved games under another domain load with their own condition, are decided normally (`GameAlreadyFinished`, `MatingPossibilityUnresolved`, no flag), and write nothing.
- **Writer tests (contract double):**
  - TST-PERSIST-054 now expects the pause.
  - TST-PERSIST-059 classifies every fixture under the same and another domain.
  - TST-PERSIST-060 shows finished and unresolved games decided normally under another domain.
- **One new DB test failed on its first run, from a defect in the test itself, not in PostgreSQL.** The DB-004 retry plan was built from an in-memory state rather than the state the writer had loaded. `planCommit` compares bindings by identity, so it threw before any SQL ran. The retry plan is now built from a real pre-mate load and committed after the finish. The assertion is unchanged.
- The Batch 8 suite (9 tests) also passed unchanged against PostgreSQL 18.6 before any 8.1 change.

### Gates (Node 24.21.0, pnpm 12.7.0, TypeScript 7.0.2)

- typecheck, lint, format:check, check:boundaries, test, test:rules, check, audit, and test:db all pass (exit 0). Audit: no known vulnerabilities.
- Normal suite: 43 files, 485 passed, 0 failed, 0 skipped, 0 todo.
  - rules: 291;
  - boundaries: 28;
  - live-game: 117;
  - persistence: 49.
- `test:db`: 1 file, 12 passed, 0 failed, 0 skipped, 0 blocked, on PostgreSQL 18.6.
- No cast, `ts-ignore`, `ts-expect-error`, or `biome-ignore` was added. No wall-clock or cross-epoch clock arithmetic in live-game or adapter source.

### Remaining gaps

- LIVE-RECOVERY-RESUME-001: no reconnect/resume operation, so a recovery-paused game cannot yet continue under a new writer.
- No outbox dispatcher or publication, and no envelope assembly.
- Retention and archive policy is TBD.
- The least-privilege runtime role (LIVE-PERSIST-004) is documented, not provisioned. The tests run as the owner of their test database.
- Mutation checks were not run.
- No transport, reconnect, lease replacement, abort, or abandonment.

## PHASE 1 / BATCH 9 — REALTIME TRANSPORT FOUNDATION

Owner-authorized (2026-09-29). Implemented, **uncommitted**, awaiting review. `HEAD` stays `b220a0090de8c13cca269ef5f2185e08f055f354` (Batch 8 + 8.1). No remote, no push, no ZIP. Batch 10 is not started. Decisions LIVE-RT-001 to 016 and the open gaps are in `PHASE_0_DECISION_CHANGELOG.md` section 19; the protocol contract is `CONTRACT_CATALOG_V1.md` section 11.

The live path is: client → `server/edge` (Fastify + `ws`) → `GameWriterRegistry` (one writer per game) → `executeCommand`/`executeDeadline` → `processCommand` → PostgreSQL → response. It is not a public production release.

### Technology and dependencies

- **fastify 5.12.5** (MIT; latest stable 5.x; no install script; published advisories are fixed at or below 5.12.1). It hosts HTTP with logging off, `bodyLimit` 1024, and 503 while closing.
- **ws 8.22.0** (MIT; zero dependencies; engines `node >=10`; no install script; the optional native peers `bufferutil` and `utf-8-validate` are not installed; published DoS advisories are fixed below 8.21.0). It runs with `noServer`, no client tracking, no permessage-deflate, `maxPayload` = the frame limit, and its own UTF-8 check disabled because the edge decodes text itself.
- **@types/ws 8.18.1** (MIT, types only, dev).
- **`@fastify/websocket` was rejected:** it pulls a duplexify and readable-stream chain, and upgrades are gated here before the handshake.
- Exact versions (`saveExact`). The first `pnpm install` was blocked by Auto-review and re-run only after the owner approved it.
- **Lockfile:** `pnpm-lock.yaml` +411 lines. It adds the edge and test importers and fastify's own dependency tree (about 50 packages, all without `requiresBuild` or an install script).
- **Audit:** `pnpm audit`: no known vulnerabilities.
- No Redis, Kafka, NATS, RabbitMQ, Kubernetes, Docker, cloud, or Supabase.

### Packages and layering

- **Layering:** Chess Rules → Live Game Core → Persistence → Runtime → Edge. The core and `processCommand` are unchanged, and nothing below the edge knows about sockets, HTTP, or JSON wire.
- **`server/live-game-runtime` (`@chess-one/live-game-runtime`)**, which depends on game-values, chess-rules, and live-game only:
  - `clock.ts`: the `MonotonicClock`, `ClockDomain`, and `WakeScheduler` interfaces.
  - `system.ts`: `createSystemClockDomain()` (`process.hrtime.bigint()`, id `boot-<uuid>`) and `createSystemWakeScheduler()`. This is the only file granted a clock and timers.
  - `bounded-queue.ts`: a ring-buffer FIFO.
  - `writer-runtime.ts`: `GameWriterRuntime`.
  - `registry.ts`: `GameWriterRegistry`.
  - `game-view.ts`: the live view.
  - `facts.ts`: the `FactSink` fact types.
- **`server/edge` (`@chess-one/edge`)**, which depends on the runtime, fastify, and ws, and imports `node:http`/`node:stream` types only:
  - `protocol/strict-json.ts`, `protocol/client-messages.ts`, and `protocol/server-messages.ts`: the wire protocol.
  - `session.ts`, `config.ts`, `token-bucket.ts`, and `facts.ts`.
  - `connection.ts`: one WebSocket connection.
  - `edge.ts`: upgrade gating and lifecycle.
- **Boundary checker (`tooling/boundaries/rules.ts`):**
  - Runtime and edge policies, and per-file ambient grants: `system.ts` alone gets `process.hrtime`, `crypto.randomUUID`, `setTimeout`, and `clearTimeout`; the edge gets timers and the `WebSocket` type name.
  - `transport_in_core`: fastify, `@fastify/*`, ws, socket.io, uWebSockets.js, `@chess-one/edge`, and `node:http`/`https`/`http2`/`net` are allowed only in the edge.
  - `client_imports_server`: clients may not import live-game, the runtime, the edge, or Fastify.
  - `clearTimeout`, `clearInterval`, `clearImmediate`, and `WebSocket` were added to the ambient list.
- **Root scripts:** `typecheck` and `check` cover both new packages. The `realtime` Vitest project runs in `test`. `test:realtime` (`vitest.realtime.config.ts`) runs every realtime test, including the PostgreSQL end-to-end tests, which `test:db` also runs.

### Writer, queue, and receipt

- **One writer per game** in the process (LIVE-RT-003, LIVE-WRITER-OWNERSHIP-001 OPEN). The registry is bounded by `maxWriters` (10000); over the limit, `server_busy WRITER_CAPACITY`.
- **Queue:** a bounded FIFO per writer, holding `maxQueuedRequests` (32) commands and syncs, counting the one in progress, plus one reserved deadline slot. Full → `server_busy WRITER_QUEUE_FULL`, and the command was not received.
- **Receipt (LIVE-RT-002):** `submitCommand` stamps `received_at = clock.now()` and enqueues in one synchronous step, before any wait. Queue delay is not charged (TST-RT-002: stamps 1100/1200/1300 committed after a hold until 90000 are charged exactly 100/100/100).
- **One job at a time.** Every job loads from the repository, so the database is the state; the writer keeps only its last published sequence and condition. A reply is sent once; the issuer's reply precedes publication to subscribers.
- **Lifecycle:**
  - A writer is created on first acquire, and a game started through `registry.startGame` is activated at once.
  - A writer with no subscribers and a stopped clock (finished, unresolved, paused, or not found) retires after `idleRetireMs`. A running game keeps its writer with no connection.
  - `dispose()` finishes the job in progress, answers the queued ones `temporarily_unavailable`, cancels every timer, and acquires nothing more.

### Time and timers

- **Clock (LIVE-RT-004):** `process.hrtime.bigint()`, relative to the domain's origin, floored to whole ms. `clockDomainId` is constant per registry. A new process is a new domain, so its running games load recovery-paused.
- **Deadline (LIVE-RT-005):**
  - The writer arms a wake at `anchor + remaining + 1`.
  - The wake stamps a deadline check with `clock.now()` and enqueues it in the same FIFO. An early wake re-arms (TST-RT-007), and the timer is wake-up only.
  - A persistence failure retries after `deadlineRetryMs`. No socket is needed (TST-RT-006, TST-RT-023 on real timers, TST-EDGE-026). *Superseded by Batch 9.1: a failed deadline check pauses play; there is no retry and no `deadlineRetryMs`.*
- **Exact deadline:** `received_at = D` is Accepted with 0 ms left, and `D + 1` is `MoveReceivedAfterDeadline` (TST-RT-005, TST-EDGE-026 over WebSocket).
- **Timer race: proven by design, not claimed from timing.** Stamp order is processing order.
  - TST-RT-008: a command stamped at D is queued before a wake that fires later but is stamped at D + 500; the command is Accepted and the wake re-arms for Black.
  - TST-RT-009: a wake stamped at D + 1 before the command: the flag is committed and the command gets `MatingPossibilityUnresolved`.
  - TST-RT-010: a command stamped at D + 1 queued before the wake is late by its own stamp, and the wake then finds nothing to do.

### Protocol, validation, and security

- **Protocol `chess_one.realtime.v1` (LIVE-RT-001, catalog section 11):**
  - Client message types: `hello`, `ping`, `sync_game`, `game_command`.
  - Server message types: `connection_ready`, `game_snapshot`, `game_update`, `command_response`, `recovery_required`, `sync_required`, `request_failed`, `server_busy`, `protocol_error`, `pong`.
- **Validation:**
  - A strict JSON parser with Map objects; duplicate keys, depth over 2, strings over 128, more than 16 keys, arrays, and ill-formed Unicode are rejected while parsing.
  - Closed field sets per message and per command. Types and lengths are checked; the game id is validated because the edge routes on it. The core still decides every meaning.
  - Frame limit 4096 (ceiling 16384). Binary frames and invalid UTF-8 are `protocol_error`, and an oversized frame closes with 1009 before parsing.
  - `protocol_error.field` is a schema name or null.
- **Upgrade gating (LIVE-RT-013):** path, method, and upgrade header, then subprotocol, origin, capacity, credential size, and the session with a timeout. All of it happens before the handshake, answered with HTTP status plus a JSON code.
- **Origins:** exact allowlist. `*` is refused, including in hostnames; production origins must be `https:` and test origins loopback. A production edge refuses a test-only resolver, and with no resolver no edge starts (TST-EDGE-CONFIG-001 to 003).
- **Trusted session (LIVE-RT-012):**
  - The `TrustedSessionResolver` interface; the only implementation is the test-only `TestTrustedSessionResolver` in `tests/realtime/support`.
  - Actor, seat, and lease come only from its grants; the transport never grants or replaces a lease.
  - A forged command (Black sending White's command with White's `actorId`) is rejected by the core, and a game outside the session is `GAME_ACCESS_DENIED` (TST-EDGE-022).
- **Facts:** codes and ids only, never tokens, credentials, or leases (TST-EDGE-051).

### Sync, updates, reconnect, and recovery

- **Sync:** `game_snapshot.v1` carries gameId, rulesetId, sequence, FEN, side to move, seat, status, playable, recoveryRequired, clock balances, and pending offer. It has no anchors, bindings, fingerprints, leases, player ids, clock domain, or database internals (TST-PROTO-020, TST-EDGE-020).
- **Order (LIVE-RT-015):** `command_response` to the issuer, then `game_update` to every subscriber, including the issuer's other connections (TST-EDGE-021, 027). The per-connection sequence guard means no regression (TST-EDGE-025: a two-player burst yields 0, 1, 2, 3 on both sides).
- **Reconnect:** a disconnect changes nothing. Reconnect, `hello`, and `sync_game` return the stored sequence and live balances, and a resent command replays with no second transition (TST-EDGE-023, 024, TST-RT-DB-001).
- **Recovery (LIVE-RT-011):** the snapshot is marked, `recovery_required` is sent, play is refused, stored bindings replay, no timer runs, and nothing auto-resumes (TST-RT-014, TST-EDGE-033, TST-RT-DB-003). LIVE-RECOVERY-RESUME-001 OPEN.

### Flow control and failures

- **Outbound (LIVE-RT-007):** over 256 KiB of unsent backlog, the connection is closed with 1008 `slow_consumer`. TST-EDGE-040 pauses a real client until the server's socket backs up: the connection closes with 1008, the game and the opponent are unaffected, and reconnect + sync works.
- **Inbound (LIVE-RT-008):** a token bucket (burst 20, 10/s) runs before parsing. The first over-limit message gets one `RATE_LIMITED`, and 50 consecutive ones close with 1008. In TST-EDGE-041, 40 commands give 4 received, 1 notice, and close 1008; the other player is unaffected.
- **Heartbeat:** a ws ping every 15 s; no pong by the next ping means the connection is terminated (TST-EDGE-042).
- **Handshake timeout:** 5 s to send `hello`, else 1008 (TST-EDGE-012).
- **Cleanup:** every close removes the socket listeners, the subscriptions, and the timers. Ten connect/sync/close cycles leave 0 connections and 0 subscribers (TST-EDGE-050). Shutdown closes all connections with 1000 (TST-EDGE-052).
- **Persistence failure (LIVE-RT-009):** `TEMPORARILY_UNAVAILABLE`, retryable, with no update and no SQLSTATE; the same id then succeeds. Covered with injected faults (TST-RT-011, 012, TST-EDGE-031) and with a real PostgreSQL error raised by a trigger inside the commit transaction (TST-RT-DB-002). *Superseded by Batch 9.1: a persistence failure pauses play (`recovery_required PERSISTENCE_UNAVAILABLE`); the same id is refused until a future resume.*
- **Concurrency conflict (LIVE-RT-010):** the writer stops, with no overwrite and no retry. Waiting requests get `TEMPORARILY_UNAVAILABLE`, subscribers get `sync_required`, and a fresh writer reloads (TST-RT-013, TST-EDGE-032).
- **Close codes:** 1000, 1002, 1008, 1009 only (LIVE-RT-014).

### Tests

- **Runtime:** `tests/realtime/writer-runtime.test.ts`, TST-RT-001 to 023, on a manual clock and scheduler over the contract repository (plus one test on real timers).
- **Edge:** `tests/realtime/edge.test.ts`, TST-EDGE-001 to 052, 34 tests over a real Fastify + ws endpoint on 127.0.0.1 with real `ws` clients.
  - **Parsing security** (TST-EDGE-014): 33 hostile or malformed texts plus binary and invalid UTF-8 frames. The runtime is never reached: 0 loads, 0 writers, and `Object.prototype` untouched.
- **Protocol:** `tests/realtime/protocol.test.ts`, TST-PROTO-001 to 031 (9 tests): strict JSON, decoding of every message and command, the largest-message size, snapshot and response encoding, the token bucket, and the bounded queue.
- **Config:** `tests/realtime/edge-config.test.ts`, TST-EDGE-CONFIG-001 to 003: fail-closed configuration.
- **PostgreSQL end to end:** `tests/realtime/realtime.db.test.ts`, TST-RT-DB-001 to 003, using real ws + Fastify + PostgreSQL 18.6 in a disposable schema; the guards are in `tests/live-game-persistence/support/disposable-schema.ts`, and a missing database is BLOCKED, never skipped.
  - **DB-001:** the 13 mandated steps, from creation through a replay that makes no second transition.
  - **DB-002:** a real in-transaction PostgreSQL failure, then a retry.
  - **DB-003:** restart. The registry is disposed, a new clock domain loads the game recovery-paused and sends `recovery_required`, play is refused, and the old binding replays with the rows unchanged.
- **Boundaries:**
  - TST-BOUNDARY-029: no transport below the edge.
  - TST-BOUNDARY-030: the runtime's imports, and grants in `system.ts` only.
  - TST-BOUNDARY-031: the edge allowlist, with no clock, environment, or randomness.
  - TST-BOUNDARY-032: clients never import server packages.
  - TST-BOUNDARY-033: realtime scripts, with no skip or only.
  - TST-BOUNDARY-024 now covers both new packages.
- **Defects found by the new tests and fixed before the gates:**
  - The runtime skipped re-arming the deadline while a deadline check was itself running. The "queued" flag is now cleared when the check starts, and TST-RT-007/008 catch it.
  - The edge let `ws` close invalid UTF-8 with 1007. The edge now validates text itself.
  - A wildcard hostname origin (`https://*.example`) parsed as a valid URL. `*` is now refused outright.

### Gates (Node 24.21.0, pnpm 12.7.0, TypeScript 7.0.2, PostgreSQL 18.6)

- typecheck, lint, format:check, check:boundaries, test, test:rules, check, audit, test:db, and test:realtime all pass (exit 0).
- **Normal suite:** 47 files, 559 passed, 0 failed, 0 skipped, 0 todo. By project: rules 291, boundaries 33, live-game 117, persistence 49, realtime 69.
- **`test:realtime`:** 5 files, 72 passed, 0 skipped, 0 blocked.
- **`test:db`:** 2 files, 15 passed (12 persistence + 3 realtime), 0 skipped, 0 blocked, in database `chess_one_test`.
- **Audit:** no known vulnerabilities.
- No cast, `ts-ignore`, `ts-expect-error`, `biome-ignore`, `any`, silent catch, floating promise, or unbounded queue was added. `check-boundaries` scans 156 files and passes.

### Remaining gaps

- **LIVE-WRITER-OWNERSHIP-001 (OPEN):** single-writer ownership holds in one process only.
- **LIVE-MULTI-CONNECTION-001 (OPEN):** connections share the writer and the lease; there is no device control or takeover.
- **LIVE-RECOVERY-RESUME-001 (OPEN):** a paused game stays paused.
- **LIVE-RETRY-RECEIPT-001 (OPEN, new):** a retry after a database outage is charged from the retry's receipt. This needs an owner decision. *RESOLVED in Batch 9.1.*
- **LIVE-WRITER-ACTIVATION-001 (OPEN, new):** a game not started through the registry, or after a writer stop, is watched only from its next request. *RESOLVED in Batch 9.1.*
- **LIVE-VIEW-ONLY-001 (OPEN, new):** no spectators.
- **Missing pieces:**
  - no production `TrustedSessionResolver`, accounts, or authentication (a production edge refuses to start);
  - no outbox dispatcher (`game.finished` stays durable in the outbox only);
  - no metrics exporter;
  - no lease replacement or abandonment;
  - no deployment.
- Mutation checks were not run.

## PHASE 1 / BATCH 9.1 — INFRASTRUCTURE PAUSE + WRITER ACTIVATION HARDENING

Owner-authorized (2026-09-29). Implemented, **uncommitted** together with Batch 9, awaiting review. `HEAD` stays `b220a0090de8c13cca269ef5f2185e08f055f354`. No remote, no push, no ZIP. Batch 10 is not started. No dependency, package, or lockfile change. Legality, SAN, repetition, draw rules, mating capability, resignation, and draw offers are unchanged. Decisions LIVE-RT-009 (replaced), 017, and 018 are in `PHASE_0_DECISION_CHANGELOG.md` section 19.

### Policy (LIVE-RETRY-RECEIPT-001, RESOLVED)

"Database/persistence outage pauses the game at the last durably committed balances. Infrastructure downtime is never charged to a player."

- **A failed commit is not executed.** The writer adopts nothing, and no sequence, binding, outbox row, `game_update`, or `Accepted` is produced.
- **Pause, not finish.** The game enters the runtime condition `infrastructure_paused`, reason `PERSISTENCE_UNAVAILABLE`. It has no `GameResult`, is not `MATING_POSSIBILITY_UNRESOLVED`, and is not the clock-domain pause.
- **Balances:** the stored balances of the last durable state, as the record already holds them. There is no wall-clock or cross-epoch arithmetic: the time since the last commit, the outage, and any retry are never measured and never charged. This can credit the player to move with the time since the last commit, which the owner accepted ("correctness and fairness over exact infrastructure-downtime accounting").
- **While paused:**
  - A command is refused at ingress (`infrastructure_paused`) before it is stamped. It is not received, reaches no queue, touches no repository, and binds no id.
  - Commands already queued behind the failing job are answered `recovery_required` and never executed.
  - No deadline check runs: the timer is disarmed, a queued check is dropped, and there is no retry (`deadlineRetryMs` is removed).
  - A sync still reads and serves the paused view: `running: false` and the stored balances.
  - Subscribers are told once, via `onRecoveryRequired`, so the edge sends `recovery_required` (reason `PERSISTENCE_UNAVAILABLE`, `requestId: null`) to every connection. The issuer also gets its own reply with its `clientCommandId`. No SQL, SQLSTATE, or driver text reaches the wire.
- **Same command id:** it stays unbound. A client may send it again after a future resume. There is no automatic transport retry.
- **No automatic resume.** The pause is held by the registry, so it outlives the writer (idle retirement, stop) and binds every later writer of the game in this process. The database answering again resumes nothing; LIVE-RECOVERY-RESUME-001 stays OPEN. A new process is a new clock domain, where the stored anchor already pauses the game.
- **Distinct reasons:** `RecoveryReason` = `RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED` (durable, the clock domain changed) | `PERSISTENCE_UNAVAILABLE` | `WRITER_FAULT`.
  - `WRITER_FAULT` covers a defect that stops the writer: the same fairness rule applies, so the running game pauses instead of losing its watcher.
  - A persistence failure on a game already known to be stopped (finished, unresolved, or clock-domain paused) has no clock to protect and is answered `TEMPORARILY_UNAVAILABLE` only.
- **Ambiguous commit** (the write landed, but a failure was reported): the command is still answered `recovery_required`. The landed transition is the durable state, so a sync serves it paused (published once), and its binding replays after a resume.

### Activation contract (LIVE-WRITER-ACTIVATION-001, RESOLVED)

- **`GameWriterRegistry.activate(gameId)`** holds the game's writer and loads the game now, with no WebSocket, subscriber, or command. It returns an `Activation`:
  - `watching`: running, with its deadline armed;
  - `stopped`: finished or unresolved, with no timer;
  - `recovery_required`: paused, with no competitive timer;
  - `unavailable`: the writer could not load the game or take the request.
- **Idempotent:** one writer per game, and `DeadlineWatch` keeps its single timer when the same instant is armed again.
- **`startGame`:**
  - It holds the writer **before** the game is stored. With no writer available it returns `writer_refused` and creates nothing.
  - It activates before returning, and returns `{ state, activation }`.
  - A create reported failed is still followed by activation. If that write landed, the game is running and nobody was told about it, so it is paused, never charged.
- **Invariant:** in this process a running game is always watched by its writer, or paused.
  - Running writers are never retired.
  - A conflict stop re-activates a fresh writer at once (`writer_reactivated`).
  - A defect stop pauses the game (`WRITER_FAULT`).
- **Boundary rule `writer_bypass`:** no server package except the core, the persistence adapter, and the runtime may import `@chess-one/live-game`. A future matchmaking or admin package can start or re-enter a game only through the registry (TST-BOUNDARY-034). No matchmaking was built.

### Structure (`server/live-game-runtime/src`)

- `writer-runtime.ts` (571 lines): the job loop only (ingress, queue, load, execute, adopt, publish, pause entry, retirement).
- `writer-port.ts` (125): what a transport sees (ingress, outcomes, `Activation`, subscriber, port).
- `writer-recovery.ts` (90): `RecoveryReason`, `InfrastructurePaused`, the effective condition, and the registry-owned `InfrastructurePauses` ledger.
- `deadline-watch.ts` (49): the single deadline wake-up.
- `registry.ts` (217): adds activation, the ledger, capacity-first start, and conflict re-activation.
- Subscriber fan-out is one helper. Nothing was split for line count alone.

### Edge

- `recovery_required.reason` is the `RecoveryReason` union. The message gained `clientCommandId` (the refused command's id, or null).
- `game_snapshot.v1` gained `recoveryReason`; `recoveryRequired` is true for every recovery reason, and `playable` is true only while running.
- An ingress refusal `infrastructure_paused` maps to `recovery_required` with the pause's own reason.

### Tests

- **`tests/realtime/infrastructure-pause.test.ts`, TST-RT-PAUSE-001 to 008:**
  - **PAUSE-001 (§9):** the player waits 250 ms and plays a legal move, and the commit fails. Position, sequence, clock, bindings, and outbox are unchanged, with no `Accepted` and no update. The clock stops, and a minute past the original deadline the view still shows the committed balances, with no flag. New commands and the same id are refused. The same id is then decided fresh (`Accepted`, not a replay) by the core over a copy of the stored rows, the state a future resume starts from.
  - **PAUSE-002 (§10):** five commands during the pause cause no queue, load, binding, retry, or timer. The database returning resumes nothing.
  - **PAUSE-003:** commands queued behind the failing commit are answered `recovery_required` and never executed.
  - **PAUSE-004:** a deadline check that cannot load pauses play: no flag, no retry, and the committed balance is kept.
  - **PAUSE-005:** a sync whose load fails pauses play; a finished game is only unavailable.
  - **PAUSE-006:** the pause outlives idle retirement.
  - **PAUSE-007:** a writer defect pauses the game as `WRITER_FAULT`.
  - **PAUSE-008:** the clock-domain pause and the infrastructure pause stay distinct.
- **`tests/realtime/writer-activation.test.ts`, TST-RT-ACT-001 to 008:**
  - **ACT-001:** activation with no socket, subscriber, or command flags at the deadline; UNKNOWN capability becomes unresolved.
  - **ACT-002:** `startGame` watches before it returns; a flag with proven capability is a win on time.
  - **ACT-003:** idempotent: one writer and one timer, however often and however concurrently.
  - **ACT-004:** a finished game gets no timer.
  - **ACT-005:** a game paused for its clock domain, a persistence-paused game, and an outage during activation all get no timer.
  - **ACT-006:** the writer is held before storing.
  - **ACT-007:** a failed create is paused if it landed; if not, no writer remains.
  - **ACT-008:** a disposed registry activates nothing.
- **Changed to the approved policy:**
  - TST-RT-011: a failed commit now pauses play.
  - TST-RT-012: an ambiguous commit is served paused and its binding replays later.
  - TST-RT-013: a conflict re-activates a fresh watching writer.
  - TST-EDGE-031: `recovery_required` goes to the mover and to every subscriber.
  - TST-RT-DB-002: rewritten below.
- **Extended for the new fields:** TST-RT-014, 019, 021, TST-EDGE-020, 033, TST-PROTO-020, TST-RT-DB-003.
- **PostgreSQL:**
  - **TST-RT-DB-002 (§9):** a real in-transaction PostgreSQL error raised by a trigger on a running game after 450 ms. Rows, position, clock, bindings, and outbox are unchanged. There is no `Accepted` and no `game_update`, and both players get `recovery_required`. After the database recovers and 10 minutes pass, the same id and a resignation are still refused, and the snapshot shows the committed balances with `running: false`.
  - **TST-RT-DB-004:** activation with no client at all. On PostgreSQL, an UNKNOWN flag is stored `unresolved` with no outbox row, and a proven-capability flag is stored `finished` with one `game.finished` outbox row.
- Every Batch 9 test is kept green: exact deadline, timer races, slow consumer, inbound flood, reconnect, replay, clock-domain pause, real WS + PG, invalid UTF-8, and wildcard origin.

### Gates (Node 24.21.0, pnpm 12.7.0, TypeScript 7.0.2, PostgreSQL 18.6, database `chess_one_test`)

- typecheck, lint, format:check, check:boundaries (161 files), test, test:rules, check, audit, test:db, and test:realtime all pass (exit 0).
- **Normal suite:** 49 files, 576 passed, 0 failed, 0 skipped, 0 todo. By project: rules 291, boundaries 34, live-game 117, persistence 49, realtime 85.
- **`test:realtime`:** 7 files, 89 passed. **`test:db`:** 2 files, 16 passed (12 persistence + 4 realtime). Both have 0 skipped and 0 blocked.
- **Audit:** no known vulnerabilities.
- No cast, `ts-ignore`, `ts-expect-error`, `biome-ignore`, or `any` was added.

### Remaining realtime gaps

- LIVE-RECOVERY-RESUME-001 (OPEN): no resume for either pause.
- LIVE-WRITER-OWNERSHIP-001 (OPEN): in-process only.
- LIVE-MULTI-CONNECTION-001 (OPEN).
- LIVE-VIEW-ONLY-001 (OPEN).
- The infrastructure pause is process memory, not durable. A crash during the pause is covered by the clock-domain pause on restart.
- No production session resolver.
- No outbox dispatcher.

## Batch 9.2: writer ownership correction and unconfirmed database outcomes

Owner review of Batch 9.1. `WRITER_FAULT` and the `writer_bypass` rule are approved. The automatic re-activation after a concurrency conflict is rejected and removed. An ambiguous create must be reconciled, never assumed. HEAD stays `b220a00`; nothing is committed. No rule, protocol message, persistence schema, rate limit, backpressure, deadline, timer-ordering, reconnect, replay, origin, or parser behaviour changed. The only wire change is two new `RecoveryReason` values.

### Concurrency conflict (LIVE-RT-010, replaced)

- **What counts as a conflict:**
  - the repository refuses a commit because the stored sequence moved (a real PostgreSQL sequence conflict);
  - the writer refuses a commit before it reaches the database because the job read a sequence this writer never published. The runtime gives the core a repository handle that records each load's sequence and passes a commit on only if `expectedSequence` is the last published sequence;
  - a decision that commits nothing was made on such a foreign sequence;
  - a sync, in play, loads any sequence other than the last one published (while paused, one behind it).
  Between its own jobs the stored sequence always equals the last published one: a bound rejection and a replay keep it, and a failed commit pauses play.
- **What happens:**
  - there is no overwrite, no retry, and no charge;
  - the game is paused in the registry ledger with the new reason `CONCURRENCY_OWNERSHIP_UNCERTAIN` (not `PERSISTENCE_UNAVAILABLE`), which overrides every durable condition, so nothing at all is written for it;
  - the deadline is disarmed;
  - subscribers get `recovery_required` and then `sync_required`;
  - the issuer and every queued command get `recovery_required`, and a queued sync gets `temporarily_unavailable`;
  - the writer stops and leaves the registry.
- **No automatic reactivation.** `#reactivate` and the fact `writer_reactivated` are removed. A later client sync may hold a writer; that writer serves PostgreSQL's state read-only (paused, `running: false`, stored balances), refuses commands at ingress, and arms no timer. Re-entering play needs an approved ownership/recovery mechanism (LIVE-WRITER-OWNERSHIP-001, LIVE-RECOVERY-RESUME-001, both OPEN).
- **Fact:** `concurrency_conflict {gameId, detectedBy: "commit" | "load"}`.

### `WRITER_FAULT` (LIVE-RT-017, approved)

- Only an exception escaping a writer job enters it. Domain rejections, persistence failures, conflicts, the clock-domain pause, and protocol errors keep their own paths (TST-RT-OWN-005).
- The fact is now `writer_fault {gameId, job}`, where `job` is the job kind only. The exception goes to `reportDefect` alone.
- A command in progress is answered `recovery_required WRITER_FAULT`, which replaces the 9.1 answer `temporarily_unavailable`.
- A throwing subscriber is reported as `subscriber_defect` and does not pause the game.

### Ambiguous create reconciliation (LIVE-RT-019)

`startGame` returns `StartGameError` = `NewGameError | game_already_exists | CreateUnconfirmed | WriterRefused`. On a create `persistence_failure`, the registry reads the game directly from the repository, outside the writer queue and on a fresh pooled connection. The writer was never activated, so no deadline was armed meanwhile. The outcome is `create_unconfirmed` with one of three reconciliation values:

- `stored`: the writer is kept and paused `PERSISTENCE_UNAVAILABLE`, and the activation is `recovery_required`. No clock runs and no command is played.
- `not_stored`: the writer reservation is disposed before `startGame` returns, leaving no writer, timer, or pause.
- `unknown`: only a `CREATE_RECONCILIATION_REQUIRED` ledger entry is kept, and no writer is held. `startGame` of that id is refused `writer_refused game_paused`. A later sync serves the stored game paused, or `game_not_found`.

Also:

- An invalid new game releases its reservation.
- A game id this process paused is refused before any create.
- Fact: `create_reconciled {outcome}`.

### Files

- `server/live-game-runtime/src/writer-runtime.ts` (641 lines): the ownership-checked repository handle, `#ownershipConflict`, foreign-sequence checks, `writer_fault`, and paused-aware release.
- `registry.ts` (274): typed reconciliation (`CreateUnconfirmed`, `StartGameError`, `game_paused`); re-activation removed.
- `writer-recovery.ts` (109): the two new reasons; uncertain ownership overrides every condition and replaces any earlier reason.
- `facts.ts` (59): `concurrency_conflict.detectedBy`, `create_reconciled`, `writer_fault`, and `subscriber_defect`; `writer_reactivated` and `writer_defect` removed.
- `index.ts`: exports the new types.
- Tests:
  - new: `tests/realtime/writer-ownership.test.ts` (TST-RT-OWN-001 to 005) and `create-reconciliation.test.ts` (TST-RT-CREATE-001 to 003);
  - changed: `writer-runtime.test.ts` (TST-RT-013), `writer-activation.test.ts` (TST-RT-ACT-007), `infrastructure-pause.test.ts` (TST-RT-PAUSE-007), `edge.test.ts` (TST-EDGE-032, new 035), `realtime.db.test.ts` (new TST-RT-DB-005, 006), and `support/repositories.ts` (a one-shot `beforeCommit` hook so another writer can commit between a load and a commit).
- Docs: changelog section 19, catalog section 11, the traceability matrix, and the v6 status line.

### Tests

- **TST-RT-OWN-001 (§5, all nine points):** two registries over one store.
  1. Writer A is running and watching.
  2. Another writer commits between A's load and A's commit, so the store refuses A's commit.
  3. A stops (`writer_retired concurrency_conflict`).
  4. No writer is created (`writer_created` stays 1, registry size 0).
  5. No wake is pending.
  6. At +900 s a client sync reads the stored balances with `running: false`, and commands are refused.
  7. No `game_update` is sent.
  8. Subscribers get `recovery_required CONCURRENCY_OWNERSHIP_UNCERTAIN`, then the stop notice.
  9. The store holds the other writer's move and binding only.
- **OWN-002:** a command decided on a foreign sequence is refused before the store.
- **OWN-003:** a stale deadline wake flags nothing.
- **OWN-004:** a sync that sees a foreign sequence pauses.
- **OWN-005:** `WRITER_FAULT` only for exceptions.
- **TST-RT-CREATE-001 (§9.1):** the insert landed and the acknowledgement failed; the read finds the game, which is paused with full balances at +900 s, no timer, and commands refused.
- **CREATE-002 (§9.2):** nothing inserted; the reservation is released, nothing is pending, and a retry starts normally.
- **CREATE-003 (§9.3):** the read also fails: outcome `unknown`, no writer, no timer, `game_paused` on retry. After the database returns, the game is served paused, or `game_not_found`.
- **TST-EDGE-032:** the conflict on the wire (a real conflict through `beforeCommit`), with no update, no writer, and play refused.
- **TST-EDGE-035:** `WRITER_FAULT` on the wire, with no error text.
- **TST-RT-DB-005:** a real PostgreSQL sequence conflict between two registries on one schema.
- **TST-RT-DB-006:** the three create cases against PostgreSQL. The insert is real in cases 1 and 3; in case 3 the unreadable read is injected at the repository boundary.

### Gates (Node 24.21.0, pnpm 12.7.0, TypeScript 7.0.2, PostgreSQL 18.6, database `chess_one_test`)

- typecheck, lint, format:check (176 files), check:boundaries (163 files), test, test:rules, check, audit, test:db, and test:realtime all pass (exit 0).
- **Normal suite:** 51 files, 585 passed. By project: rules 291, boundaries 34, live-game 117, persistence 49, realtime 94.
- **`test:realtime`:** 9 files, 100 passed. **`test:db`:** 2 files, 18 passed.
- 0 failed, 0 skipped, 0 blocked, 0 todo.
- **Audit:** no known vulnerabilities.
- No dependency, cast, `as const`, `ts-ignore`, `ts-expect-error`, or `biome-ignore` was added.

## PHASE 1 / BATCH 10 — ACCOUNTS + IDENTITY + AUTHENTICATION FOUNDATION

Owner-authorized (2026-09-29): registration, login, logout, Argon2id password storage, opaque server sessions in HttpOnly cookies, revocation, and a production `TrustedSessionResolver` wired to the realtime edge. Batch 9, 9.1, and 9.2 are committed as `21362ce`; Batch 10 is uncommitted and pending review, and HEAD stays `21362ceeaceab27dd5aaaca90b5deb86ea2dd4d2`. No remote, no push, no ZIP. Not in scope and not built: final UI, OAuth, MFA, friends, matchmaking, rating, tournaments, payments, store, messages, full profiles, RBAC, SMTP or any email provider. Owner decisions applied: logout-all revokes every session including the current one; registration signs the user in at once; a password change revokes every session including the current one and then issues a new session to the device that changed it. No rule, live-game, persistence (live-game), runtime, or realtime protocol behaviour changed; the edge gained the `/auth` routes and two close reasons.

### Layering

`domain/identity` (pure values and policies) → `server/accounts` (application: use cases, hashing, tokens, sessions, throttling; knows no HTTP, SQL, or game) → `server/accounts-persistence` (PostgreSQL adapter, Kysely) → `server/edge` (HTTP `/auth` routes and the production session resolver). `server/live-game*` never depend on accounts; accounts never imports live-game. Every boundary is enforced by `check:boundaries` (TST-BOUNDARY-035 to 040).

### Identity (`domain/identity/src`)

- `user-id.ts`: `UserId` is a lowercase random v4 UUID chosen by the server (`randomUUID` in `server/accounts`). The username and email are never keys.
- `username.ts`: ASCII letters, digits, `_`, `-`; 3 to 24 characters; alphanumeric first and last; no `__`, `--`, `_-`, `-_`; a small reserved list (`admin`, `api`, `auth`, `chess-one`, ...). The display form is kept exactly as typed; the canonical form is ASCII lowercase, so `Taher`, `taher`, and `TAHER` are one account. No Unicode, so no confusables.
- `email.ts`: only surrounding whitespace is trimmed and case is folded (the whole address, documented as a deliberate simplification: RFC 5321 local parts are case-sensitive in theory, never in practice for account providers). Dots and `+tags` are kept; no provider-specific rules. Printable ASCII only, at most 254 characters, local part at most 64, one `@`, dot-atom local part, LDH domain labels with a dot. `email` (display) and `canonical_email` are stored separately with a unique constraint on the canonical form. IDN/EAI addresses are refused (AUTH-EMAIL-IDN-001).
- `password-policy.ts`: 15 to 256 code points (12 until Batch 10.1); passphrases and spaces are allowed; nothing is trimmed, normalized, or truncated; ill-formed UTF-16 and control characters are refused; a new password may not equal the username or email in any case. Login checks only that the input is encodable and at most 256 code points, so accounts created under an earlier, lower minimum still sign in. No composition rules.
- `login-identifier.ts`: with `@` an email, without a username, anything else `unknown` (still hashed against the dummy).
- `account-status.ts`: `active`, `disabled`, `locked`; only `active` authenticates.

### Password hashing (`server/accounts/src/password-hasher.ts`)

- **Library:** Node's built-in `crypto.argon2` (Node 24.7+, OpenSSL 3.2+ implementation). No new dependency. Vetting: part of the Node runtime already trusted by the project, maintained by the Node security team, no native add-on to build, no install scripts. On construction the hasher runs the RFC 9106 §5.3 Argon2id known-answer test and refuses to start if the runtime disagrees (TST-AUTH-HASH-001).
- **Parameters (configuration):** production default RFC 9106 second recommended option: m = 64 MiB, t = 3, p = 4, 16-byte salt, 32-byte tag. A hasher reports `production` strength only if its parameters meet an OWASP minimum row (m ≥ 46 MiB at t = 1, 19 MiB at t = 2, 12 MiB at t = 3, ...); weaker parameters are `test_only` and a production accounts configuration refuses them (TST-AUTH-CONFIG-001). Tests use 8 KiB, t = 1.
- **Format:** the PHC string `$argon2id$v=19$m=…,t=…,p=…$salt$tag`, parsed strictly (canonical unpadded base64, bounded parameters, argon2id v19 only). `needsRehash` compares stored parameters with the configured ones; a successful login with outdated parameters rehashes and stores the new hash by compare-and-set (`password_rehashed`).
- **Bounded work:** a `WorkGate` limits concurrent derivations (`maxConcurrent`) and waiting ones (`maxWaiting`); past that a request is refused synchronously as `busy` (HTTP 503 `SERVICE_BUSY`, `Retry-After: 1`), never queued without bound.
- **Enumeration:** verifying against a missing hash runs one real derivation against a dummy hash made at startup with the same parameters, so an unknown account costs the same Argon2id work as a wrong password (TST-AUTH-HASH-005, TST-AUTH-LOGIN-002). No timing-based test.
- **Compromised passwords:** `CompromisedPasswordScreen` extension point, consulted for every new password (registration, change, reset). The default screens nothing; no external call is made (AUTH-BREACHED-PASSWORD-001).
- **Pepper:** none (AUTH-PEPPER-001).

### Tokens (`tokens.ts`)

Session, reset, and verification tokens are 32 bytes from `crypto.randomBytes`, encoded base64url (43 characters). Only `SHA-256("chess-one:<purpose>:v1:" + token)` is stored (32-byte `bytea`); a token of one purpose never matches another purpose's digest. Malformed token shapes are refused before any lookup. Tokens, digests, and passwords never appear in facts, errors, logs, or response bodies.

### Sessions

- **Cookie:** production `__Host-chess_one_session=<token>; Path=/; Max-Age=<absolute lifetime>; HttpOnly; Secure; SameSite=Lax`, no `Domain`. The test and loopback mode `chess_one_session` drops only `Secure` (and therefore the `__Host-` prefix); a production edge refuses it (`EdgeConfigError`, TST-AUTH-COOKIE-005).
- **Lifetime (AUTH-SESSION-002):** absolute 30 days, never extended; idle 7 days; `last_seen_at` written at most once per 15 minutes; at most 32 counting sessions per user, the least recently seen revoked (`session_limit`) under the user row lock. Every use checks: not revoked, before absolute expiry, within the idle window, account active.
- **Revocation:** logout (idempotent, clears the cookie even without a session), logout-all (including the current session), revoke one own session (another user's id is 404, IDOR), password change, password reset, account disabled or locked, session limit. Revocation is a database row update with a reason.
- **Session fixation:** every sign-in (register, login, password change) creates a new random token; a token the client presents is never adopted or extended into a new session (TST-AUTH-E2E-003).
- **Maintenance:** `purgeEnded(retentionMs)` deletes sessions revoked or absolutely expired before the cutoff and expired action tokens; the host schedules it (no timer inside accounts).

### Use cases (`credentials.ts`, `recovery.ts`, `sessions.ts`, `accounts.ts`)

- **register:** throttle (client address, then registration), validate username, email, and password, screen, hash, then one transaction inserts `users`, `user_credentials`, and the first session. The unique constraints decide races: `username_taken`/`email_taken` → `username_unavailable`/`email_unavailable` (409). Registration therefore reveals that a name or address is taken (AUTH-ENUMERATION-001).
- **login:** by username or email in any case; throttled per client address and per canonical identifier; always exactly one Argon2id verification. Unknown account and wrong password are one answer (`INVALID_CREDENTIALS`, 401, byte-identical bodies). A disabled or locked account is revealed (`ACCOUNT_UNAVAILABLE`, 403) only after the correct password, with the fact `account_disabled_auth_attempt`. The session is created in one transaction under the user row lock, and only if the stored hash is still the one the login verified (or rehashed to): a password change or reset that commits while the Argon2id verification runs would otherwise leave the old password with a fresh session after every session was revoked. That login gets `INVALID_CREDENTIALS` and the fact `login_failure password_changed` (`createSession` returns `stale`; TST-AUTH-LOGIN-006, TST-AUTH-DB-017). This race was found during the batch's self-review and fixed before review.
- **changePassword:** needs the current password (throttled per user), screens the new one, then in one transaction compare-and-sets the hash, revokes every session, and inserts the new session.
- **password reset:** `requestPasswordReset` always answers 202 for a well-formed address; only an active account's address gets a token, delivered through `AccountTokenDelivery` (a test sink in this batch; no SMTP). The token (30 minutes, single use, bound to the address it was sent to, superseding earlier ones) is consumed by one conditional UPDATE; the reset sets the password, revokes every session, and signs nobody in.
- **email verification:** request needs a session (202, or 409 `ALREADY_VERIFIED`); confirm consumes a 24-hour single-use token. Verified status is stored and shown as `emailVerified`; nothing requires it yet.
- **setAccountStatus:** disabling or locking revokes every session and closes the user's open sockets. No admin API or role exists; the operation is for a future operator tool.
- **Transactions:** every multi-row change is one transaction; failures inside roll back completely (TST-AUTH-DB-012 to 015). Store errors become `AccountsStoreError(operation, detail)` where the detail is only `sqlstate XXXXX`, `malformed <column>`, or `unexpected`; the edge answers 503 `SERVICE_UNAVAILABLE` with no SQL, SQLSTATE, table, or driver text.

### Rate limits (AUTH-RATE-LIMIT-001)

In-process credit buckets, keyed by a SHA-256 digest (never the raw identifier), with LRU eviction at `maxKeysPerLimiter` (50000) per scope: client address 30 burst, 1 per 2 s; registration 10, 1 per 5 min; login identifier 10, 1 per min; password change 5, 1 per min; reset request 3, 1 per 15 min; verification request 3, 1 per 15 min. A refused attempt costs no hashing, answers 429 with `Retry-After`, and never locks the account. Single-process only (AUTH-RATE-LIMIT-DISTRIBUTED-001). The client address is Fastify's `request.ip` with `trustProxy` off (AUTH-PROXY-001).

### HTTP (`server/edge/src/auth`)

- **Routes** under `/auth`: `POST /register` (201), `POST /login` (200), `POST /logout` (204), `POST /logout-all` (204), `GET /me`, `GET /sessions`, `DELETE /sessions/:sessionId` (204), `POST /password` (200 with a new cookie), `POST /password-reset/request` (202), `POST /password-reset/confirm` (204), `POST /email-verification/request` (202), `POST /email-verification/confirm` (204). Anything else is 404 `auth_error.v1`.
- **Bodies:** `application/json` only, at most 8192 bytes (413), parsed by the edge's strict JSON parser (flat object, string members, no duplicate keys, at most 4 keys, strings at most 1024), with exactly the expected members; anything else is 400 `INVALID_REQUEST`. No body field names a user, session, role, or seat; identity comes only from the cookie.
- **Wire formats:** `auth_user.v1` `{userId, username, status, emailVerified}` (no email, hash, token, or internal field); `auth_sessions.v1` `{sessionId, createdAt, lastSeenAt, current}`; `auth_error.v1` `{code, field?, reason?, retryAfterMs?}`. Catalog section 12.
- **CSRF (AUTH-CSRF-001):** SameSite=Lax cookies; every non-GET request must carry an allowlisted `Origin` (the edge's exact-match allowlist, never `*`); POST must be `application/json` (a cross-site HTML form cannot send it, 415); `Sec-Fetch-Site: cross-site` is refused on every route; no CORS headers are ever sent, so no cross-origin script can read a response. A synchronizer CSRF token was evaluated and not added: with these four checks it defends nothing extra for a same-origin JSON API.
- **Security headers** on every edge response: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` (for the API's own responses only; this is not a site CSP), `Cross-Origin-Resource-Policy: same-origin`, and HSTS (`max-age=31536000`) in production only.
- **Logging:** Fastify logging stays off; facts carry codes and ids only.

### Realtime (`session-resolver.ts`, `connection.ts`)

- `ProductionTrustedSessionResolver`: cookie → token digest → session → account status → `actorId = userId`. The `Authorization` header is not a credential. Seats and control leases come from a `GameAccessResolver`; production has `NO_GAME_ACCESS` (grants nothing) until matchmaking exists, and tests use a `test_only` adapter. Its trust is `production` only with a secure cookie and production game access.
- Missing, malformed, duplicated, unknown, expired, idle, or revoked sessions and disabled or locked accounts are refused 401 before the upgrade.
- **Open sockets (AUTH-REVOCATION-001):** each connection registers a watcher for its session. A revocation made by this process (logout, logout-all, revoke one, password change or reset, disable, session limit) closes the matching sockets at once with 1008 `session_ended`. A periodic recheck (`sessionRecheckIntervalMs`, default 60 s, ceiling 1 h) catches revocations made elsewhere and expiries; a recheck the store cannot answer closes with 1008 `session_unverifiable`. No per-message database lookup. Watchers are removed when a socket closes, so the registry holds only open connections.
- **Session epoch:** evaluated and not added; every revocation already names its sessions, and the recheck covers the rest.
- Email never appears in any WebSocket message.

### Persistence (`server/accounts-persistence`)

Migrations 001 to 004 (new files only; live-game migrations untouched), with their own bookkeeping tables `accounts_schema_migrations` and `accounts_schema_migration_lock` (DEC-048 ownership): `users` (format, canonical-form, and status checks; unique canonical username and email), `user_credentials` (PHC format check, scheme `argon2id`), `user_sessions` (32-byte digest, unique; time and revocation-reason consistency checks; partial index on live sessions per user), `account_action_tokens` (digest key, purpose, expiry). No password column in `users`. Timestamps are written as ISO strings from `wall-time.ts` and read as epoch milliseconds computed in SQL; the driver never parses dates. `accountsMigrator(db, dir, schema)` pins the bookkeeping tables to a schema: without it Kysely accepts a same-named bookkeeping table in any schema (found when two suites migrated concurrently; TST-AUTH-DB-016).

A constraint defect was found by the new PostgreSQL tests and fixed: the session revocation check accepted `revoked_at` with a NULL reason (`NULL IN (...)` is not false). It now requires the reason explicitly (TST-AUTH-DB-004).

### Facts

`registration_success`, `registration_rejected`, `login_success`, `login_failure`, `session_created`, `session_revoked`, `session_rejected`, `password_changed`, `password_change_failed`, `password_rehashed`, `password_reset_requested`, `password_reset_completed`, `password_reset_rejected`, `email_verification_requested`, `email_verified`, `email_verification_rejected`, `account_status_changed`, `account_disabled_auth_attempt`, `token_delivery_failed`, `auth_rate_limited` (accounts), and `auth_request_refused {origin | fetch_site | media_type | malformed_cookie}` (edge). Codes and ids only: no password, token, digest, email, or identifier text.

### Tests

- **Local (`pnpm test`, project `accounts`, 100 tests):** `identity.test.ts` (TST-AUTH-ID-001 to 013, with fast-check properties); `primitives.test.ts` (HASH-001 to 010, TOKEN-001 to 003, LIMIT-001 to 004); `accounts.test.ts` over an in-memory repository with PostgreSQL semantics (REG-001 to 004, LOGIN-001 to 006, SESSION-001 to 010, PASSWORD-001 to 003, RECOVERY-001 to 006, THROTTLE-001 to 004, CONFIG-001 to 003, STORE-001); `cookie.test.ts` (COOKIE-001 to 005); `http.test.ts` through Fastify `inject` (HTTP-001 to 019: status codes, cookie attributes, identical failure bodies, IDOR, CSRF and origin refusals, strict bodies, 413, 415, 429, 503 without leaks, security headers, no CORS headers, recovery routes); `websocket-auth.test.ts` with real `ws` sockets (WS-001 to 009: cookie handshake, refusals, immediate close on every revocation path, recheck after an out-of-process revocation, idle expiry, store failure, no per-message lookup).
- **PostgreSQL (`pnpm test:db` and `pnpm test:auth`, 20 tests):** `accounts.db.test.ts` (TST-AUTH-DB-001 to 017: migrations up, down, and up again; coexistence with live-game migrations; exact index set; no password or raw-token column; 16 constraint violations by SQLSTATE and constraint name; full flows; digest-only storage; touch throttling and expiry; session cap under concurrency; concurrent duplicate usernames and emails in any case with exactly one winner; single-use reset under six concurrent attempts; rollback of registration, session creation with eviction, password change, and reset; `AccountsStoreError` text without driver detail; schema-pinned bookkeeping; a login whose password changed during verification gets no session); `websocket-auth.db.test.ts` (TST-AUTH-E2E-001 to 003).
- **TST-AUTH-E2E-001 (§58, all eleven steps):** real HTTP registration of two users; real `fetch` login; the cookie from `Set-Cookie`; a real WebSocket carrying only the cookie; `connection_ready.actorId` is the user id; the seat granted by game access; sync at sequence 0; a move `Accepted` and committed to PostgreSQL (sequence 1), the opponent receiving `game_update`; real logout (204, cookie cleared); the session revoked in PostgreSQL (`logout`) and the socket closed at once with 1008 `session_ended`; reconnect with the same cookie refused 401 and `/auth/me` 401; the opponent's socket unaffected.
- **Boundaries:** TST-BOUNDARY-035 to 040 (identity pure; accounts without Fastify, database, or game; the accounts store without transport or clock outside `wall-time.ts`; the edge through the accounts public entry only and never its store; live-game core and runtime without accounts; clients without accounts or its store) and 041 (auth test wiring, no skips). `writer_bypass` unchanged.

### Dependencies

No new third-party dependency. New workspace packages `@chess-one/identity`, `@chess-one/accounts`, `@chess-one/accounts-persistence`, `@chess-one/tests-accounts`; the edge depends on `@chess-one/accounts`. Existing exact pins reused (kysely 0.29.6, pg 8.23.0, @types/pg 8.23.1, ws 8.22.0, @types/ws 8.18.1).

### Gates (Node 24.21.0, pnpm 12.7.0, TypeScript 7.0.2, PostgreSQL 18.6, database `chess_one_test`)

- typecheck, lint, format:check, check:boundaries, test, test:rules, check, audit, test:db, test:realtime, and the new test:auth all pass (exit 0).
- **Normal suite:** 57 files, 692 passed. By project: rules 291, boundaries 41, live-game 117, persistence 49, realtime 94, accounts 100.
- **`test:auth`:** 8 files, 120 passed. **`test:db`:** 4 files, 38 passed. **`test:realtime`:** 9 files, 100 passed.
- 0 failed, 0 skipped, 0 blocked, 0 todo.
- **Audit:** no known vulnerabilities.
- No `any`, cast, `as const`, `ts-ignore`, `ts-expect-error`, `biome-ignore`, silent catch, unbounded map, plaintext secret, hard-coded production domain, or real password was added.

### Remaining gaps

AUTH-RATE-LIMIT-DISTRIBUTED-001, AUTH-REVOCATION-BROADCAST-001, AUTH-RESOLVE-WATCH-GAP-001, AUTH-RESET-TIMING-001, AUTH-PEPPER-001, AUTH-BREACHED-PASSWORD-001, AUTH-EMAIL-DELIVERY-001, AUTH-EMAIL-IDN-001, AUTH-PROXY-001, AUTH-ENUMERATION-001, AUTH-GAME-ACCESS-001, PERSIST-MIGRATION-SCHEMA-001, and the product questions in changelog section 20 (answered by Batch 10.1).

## PHASE 1 / BATCH 10.1 — ACCOUNT POLICY DECISIONS + SECURITY BASELINE

Owner decisions (2026-09-29) answering AUTH-PRODUCT-001 to 007; changelog section 21. Batch 10 and 10.1 are uncommitted and pending review; HEAD stays `21362ceeaceab27dd5aaaca90b5deb86ea2dd4d2`. No remote, no push, no ZIP. Unchanged: Argon2id and its parameters (v19, 64 MiB, 3 passes, 4 lanes, 16-byte salt, 32-byte output), the session architecture (opaque tokens, digest storage, secure cookie, logout, logout-all, revocation, rotation after a password change), the WebSocket session resolver, and every open gap.

### Decisions

- **Email mandatory** for every registered account (AUTH-EMAIL-REQUIRED-001); already enforced. A future guest mode is separate.
- **Username fixed** in the first release; no rename endpoint (AUTH-USERNAME-RENAME-001, DEFERRED, with the conditions a future rename policy must meet).
- **Display name** separate from the username is a future Profile / Public Identity requirement (AUTH-DISPLAY-NAME-001); not added.
- **Minors:** not supported and not claimed; no birth date or guardian data collected (AUTH-AGE-GUARDIAN-001, OPEN).
- **Verified email:** not needed to register or sign in; future high-trust features (rated play, rated tournaments, economy or value features) will require it (AUTH-EMAIL-VERIFIED-001). No enforcement is invented in systems that do not exist; `emailVerified` stays on the profile, the login account, and `auth_user.v1`.
- **Registration enumeration:** username disclosure accepted; the email answer is the bare code `EMAIL_UNAVAILABLE`, but email enumeration is not solved and AUTH-ENUMERATION-001 stays open until the production email verification and delivery flow. No cosmetic masking.

### Password minimum 12 → 15 (AUTH-PASSWORD-002)

`PASSWORD_POLICY.minLength` is 15 (`domain/identity/src/password-policy.ts`); the maximum stays 256 and every other rule is unchanged. The error response is unchanged in shape (`VALIDATION_FAILED`, `field`, `reason: too_short`); catalog section 12.2 now states the bounds. Tests: TST-AUTH-ID-007 (14 refused, 15 accepted, 256 accepted, 257 refused, a 256-character spaced passphrase accepted and 257 refused, leading spaces counted), TST-AUTH-ID-008 (14 and 15 emoji), TST-AUTH-ID-009 (identifier match now uses a 16-character username, since a shorter one is refused as too short first), TST-AUTH-REG-004 (screened password lengthened to 16), new TST-AUTH-REG-005 (registration: 14 and 257 refused with nothing stored; 15, 256, and a spaced passphrase registered), TST-AUTH-HTTP-012 (14 and 257 are 400, 15 is 201, and the email-taken body is exactly the code). All other fixture passwords were already at least 15.

### `repository.ts` review (PERSIST-ACCOUNTS-REPOSITORY-001)

Extracted without behaviour change: `store-error.ts` (48 lines: `AccountsStoreError`, `MalformedRow`, SQLSTATE and constraint-name extraction) and `rows.ts` (107 lines: epoch milliseconds, id, status, flag, and canonical-form checks; session and profile row decoding). The transaction helpers (user row lock, revoke-all, capped session insert, single-use token consumption) stay with `PostgresAccountsRepository` in `repository.ts` (600 lines), because they encode the lock order every transaction relies on; splitting the class by table would scatter one transaction across files. The package's public exports are unchanged.

### Files changed in 10.1

`domain/identity/src/password-policy.ts`; `server/accounts-persistence/src/repository.ts`, `index.ts`, new `rows.ts` and `store-error.ts`; `tests/accounts/identity.test.ts`, `accounts.test.ts`, `http.test.ts`; `PHASE_0_DECISION_CHANGELOG.md`, `CONTRACT_CATALOG_V1.md`, `PHASE_1_IMPLEMENTATION_LOG.md`, `TRACEABILITY_MATRIX_V2.md`, and the v6 status line.

### Gates

typecheck, lint, format:check, check:boundaries (216 files), test, test:rules, check, audit, test:db, test:realtime, and test:auth all pass (exit 0). Normal suite 57 files, 693 passed (accounts 101); `test:rules` 291; `test:auth` 8 files, 121 passed; `test:db` 4 files, 38 passed; `test:realtime` 9 files, 100 passed. 0 failed, 0 skipped, 0 blocked, 0 todo. Audit: no known vulnerabilities. No dependency, cast, `as const`, suppression, or `any` added.

### Remaining gaps

AUTH-RATE-LIMIT-DISTRIBUTED-001, AUTH-PROXY-001, AUTH-REVOCATION-BROADCAST-001, AUTH-RESOLVE-WATCH-GAP-001, AUTH-RESET-TIMING-001, AUTH-PEPPER-001, AUTH-BREACHED-PASSWORD-001, AUTH-EMAIL-DELIVERY-001, AUTH-EMAIL-IDN-001, AUTH-ENUMERATION-001 (email), AUTH-GAME-ACCESS-001, PERSIST-MIGRATION-SCHEMA-001, AUTH-AGE-GUARDIAN-001; deferred AUTH-USERNAME-RENAME-001; future requirement AUTH-DISPLAY-NAME-001.

## PHASE 1 / BATCH 11 — GAME ACCESS + SEAT AUTHORITY + CONTROL LEASE FOUNDATION

Owner-authorized (2026-09-29). Batch 10 and 10.1 are committed as `53d85e24cd25df3aa2f7a339c7ad47bd3100342a`; Batch 11 is uncommitted and pending review, and HEAD stays there. No remote, no push, no ZIP. Changelog section 22 (decisions GACC-001 to GACC-014).

### Scope

The chain from a signed-in account to a command the live game will play: session → `UserId` → the game's durable seat assignment → the session that controls the seat → the seat's control lease → admission by the game's single writer → the live-game core's final validation. The client sends only a game id and command semantics; it never names a user, seat, session, or lease. Out of scope and not started: matchmaking, public challenges, friends, rating, tournaments, spectators and view-only access, guests, UI, chat, notifications, AI, Redis or any broker, multi-region, and distributed writer ownership.

### Packages

- **`server/game-access`** (new, `@chess-one/game-access`): `values.ts` (assignment, control record, decisions, refusal and revocation codes), `ports.ts` (`GameAccessStore`, `GameAccessStoreError` `unavailable`/`corrupt`), `resolver.ts` (`ProductionGameAccessResolver`), `control.ts` (`GameControlService`), `assignments.ts` (`createAssignedGame`, `reconcileAssignment`), `writer-lease.ts` (lease application through the runtime), `serializer.ts` (`KeyedSerializer`, one change per game at a time), `watchers.ts` (`ControlWatchers`, bounded), `leases.ts` (256-bit leases from `node:crypto`), `session-authority.ts` (`SessionGameAuthority`, `GameAccessProvider`), `command-context.ts` (`TrustedGameCommandContext`), `facts.ts`, `game-access.ts` (`GameAccess`, the composition root). It sees accounts, identity, the runtime, and `node:crypto` only; never the core, a store adapter, or a transport.
- **`server/game-access-persistence`** (new): migrations `001_game_assignments` and `002_game_seat_control` (new files only; accounts and live-game migrations untouched) with their own schema-pinned bookkeeping tables, and `PostgresGameAccessStore`.
- **Changed:** `server/live-game` (control-lease rotation), `server/live-game-persistence` (the `control` commit plan), `server/live-game-runtime` (admission check, `applyControlLease`, `replayCommand`, `ControlDirectory`), `server/accounts` (`AccountDirectory`, `SessionEndListener`), `server/edge` (claim protocol, per-connection seat control, the production resolver over `GameAccessProvider`), `tooling/boundaries/rules.ts`.

### Design

- **Assignment (GACC-001, GACC-002).** `game_assignments` holds the two users of a game, one per seat, fixed at creation; PostgreSQL refuses the same user on both seats, unknown users, and a second row for a game id, and `ON DELETE RESTRICT` keeps users with games. `game_seat_control` holds one row per seat from the moment the assignment exists.
- **`createAssignedGame` (GACC-003)** is internal and trusted; there is no public `POST /games`. It checks both users exist, are distinct, and are active (and verified, if the policy hook is on); reserves a `pending` assignment with both control rows (holder none, fresh leases); starts the live game through the runtime registry with the same players and leases; then confirms. Nothing reports success unless the game was started and the assignment confirmed. A start that surely stored nothing discards the reservation; a start whose outcome is uncertain, or a confirm that fails, returns `creation_unconfirmed` (`stored` or `unknown`) and leaves a `pending` row that `reconcileAssignment` settles: confirmed only when the live game's snapshot is read, discarded only on an explicit `game_not_found`, otherwise `unknown` (fail closed). A game id already stored in the live game is refused `start_refused game_already_exists` and the reservation discarded. `pending` grants the same access as `confirmed`, so a player of a game that exists can always reach it.
- **Resolver (GACC-004).** `ProductionGameAccessResolver.resolve(userId, gameId)` answers `player_white`, `player_black`, `no_access`, `game_not_found`, or `unavailable`, from the assignment only. At the edge `no_access` and `game_not_found` are one answer (`GAME_ACCESS_DENIED`), so a stranger cannot learn whether a game exists (IDOR).
- **Control (GACC-005 to GACC-007).** One controlling session per seat, stored with a version that grows by one with every change of holder or lease (compare-and-set). The lease is 43 base64url characters (256 random bits), unique, generated by the server, and never sent to a browser. Access never takes control. A claim by the holder keeps its lease (so a reconnect of the same session keeps control); a claim by another session of the same player rotates the lease and names that session as holder. There is no silent takeover: a second session syncs and sees its seat with `controlHeld: false`, and its commands are refused `CONTROL_NOT_HELD` until it sends `claim_game_control`. A new game starts with no controller; each player claims once.
- **Claim order (GACC-006).** Per game, changes run one at a time in this process (`KeyedSerializer`). A claim checks: the resolver (seat), the session is still active, the game is open (not finished or rules-unresolved), then CAS-transfers the control record, queues the new lease into the writer, and only then notifies watchers (so the writer refuses the old lease before anyone is told). The session is checked again after the transfer; if it ended meanwhile, the seat is released at once. A CAS that loses to another process is `conflict`; nothing is taken.
- **Two writes, fail closed.** The control record is written first, the writer's lease second. If the second step fails or the process stops between them, the old holder has already lost control at the edge and the new holder's lease is not yet admitted by the writer, so nobody plays until the holder's next access or claim re-applies the stored lease (TST-GACC-SVC-017).
- **Revocation (GACC-008).** Accounts calls a `SessionEndListener` after it stores a revocation or status change; accounts knows nothing of games. Logout, logout-all, revoke-one, password change or reset, and session limit release the session's seats with `session_revoked`; disabling or locking an account releases every seat of the user's games with `account_closed`; an expiry seen by the edge releases with `session_ended`. A release leaves the seat with no controller and a fresh lease nobody holds. Nothing is resigned and no other session is assigned; a seat whose stored holder is a revoked session is control for nobody (TST-GACC-DB-007).
- **Admission linearization point (GACC-009).** `submitCommand` compares the actor's lease with the seat's lease as of the end of the queue (the stored lease with every queued rotation applied) synchronously, before stamping `receivedAt`. A mismatch is refused `{accepted: false, reason: "control_not_held"}`: no queue entry, no stamp, no clock effect, no sequence, no binding. So the moment a rotation is accepted into the writer's queue is the linearization point of a control change: every command admitted before it runs under the old lease, and none is admitted under the old lease after it. A writer that has not loaded the game yet admits provisionally and checks the lease first thing in the job, before the core, discarding the stamp (`control_not_held`, nothing decided or bound).
- **Rotation in the core (GACC-010).** `withControlLease` (new `control-lease.ts`) changes one seat's lease and nothing else; two seats never share a lease. `executeLeaseRotation` stores it with `planLeaseRotation` (the new `control` commit plan: compare-and-set on the stored sequence, writes only the lease, keeps the clock domain). It runs in every condition, a recovery pause and a finished game included, because a lease decides who may send commands, never whether a command is played. `planCommit` now refuses, as a defect, any decision that changes a lease. A claim therefore changes no clock, sequence, position, repetition history, result, or outbox row (TST-GACC-SVC-003, TST-GACC-CORE-001, 005, 006).
- **Replay after rotation (GACC-011; superseded by Batch 11.1, GACC-015).** The binding store is still the idempotency authority. The edge remembers, per connection and seat, the command ids admitted under the held lease (at most `REMEMBERED_COMMANDS` = 64, oldest evicted). When the session loses control, only an exact resend of one of those ids goes to the writer's read-only `replayCommand` under the former lease, which returns the stored decision (`replayed`) or refuses; anything else is `CONTROL_NOT_HELD` at the edge and never reaches the writer. After a reconnect nothing is remembered: an uncertain command of a former controller is answered by resyncing, not replay.
- **Lost notice (GACC-012).** `control_revoked` is a courtesy. The writer refuses the old lease whether or not the notice arrives (TST-GACC-EDGE-005).
- **Composition.** `GameAccess` composes the resolver, control, assignments, and the accounts hook; `forSession(session, userId)` gives the edge a `SessionGameAuthority` (`access`, `claim`, `watchControl`, `sessionEnded`). The edge fills a command's lease from what its session holds (`trustedCommandContext`: actor, seat, lease) and never picks a seat or lease itself. A client `controlLeaseId` is still length-checked for v1 compatibility, then discarded.
- **Restart (GACC-013).** Assignments and control records survive a restart. A new process is a new clock domain, so the game is recovery-paused (`RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED`); the stored holder still controls it, and a claim still works, but control grants no resume authority (LIVE-RECOVERY-RESUME-001 stays open).
- **Snapshots (GACC-014).** `game_snapshot.v1` gains `controlHeld` and `canClaimControl` (not held and the game active). It never carries a session id, lease, internal id, or the opponent's user id.
- **Verified-email hook.** `AssignmentPolicy.requireVerifiedEmail` (default off) refuses unverified accounts as `email_not_verified` when enabled (AUTH-EMAIL-VERIFIED-001); nothing turns it on.
- **Store integrity.** Every single-key read fetches two rows and treats a duplicate as corrupt; a holder session belonging to another user, a bad seat, lease, or version, and the same user on both seats are corrupt. Corruption and outages fail closed (`unavailable`, fact `game_access_unavailable`, a reported defect), never a grant.
- **Limits.** Claims 5 per session burst, one more every 2 s (LRU at 50000 sessions); at most 64 seats listed in `connection_ready`; at most 65536 control watchers per process (a full registry means no notice, and the writer still refuses stale leases).

### Protocol (`chess_one.realtime.v1`, additive)

New client message `claim_game_control {requestId?, gameId}`; new server messages `control_granted {requestId, gameId, seat}`, `control_denied {requestId, gameId, code, retryable}` (`GAME_ACCESS_DENIED`, `GAME_CLOSED`, `SESSION_ENDED`, `RATE_LIMITED`, `CONFLICT`, `TEMPORARILY_UNAVAILABLE`), and `control_revoked {gameId, seat, code}` (`CONTROL_TRANSFERRED`, `CONTROL_RELEASED`); new `request_failed` code `CONTROL_NOT_HELD`; snapshot fields `controlHeld` and `canClaimControl`. `connection_ready.games` lists seats and grants nothing. The version stays v1: every addition is a new message, code, or field, and no client depended on the old static lease (production granted no game until now). Catalog sections 4, 11, and 13.

### Facts

Game access: `game_assignment_created`, `game_assignment_failed`, `game_assignment_reconciled`, `game_access_denied`, `game_control_claimed {rotated}`, `game_control_denied`, `game_control_revoked {reason}`, `game_control_conflict`, `game_access_unavailable {operation, cause}`. Runtime: `command_refused_control`, `control_lease_rotated`. Edge: `command_refused_control`, `control_claim {outcome}`, `control_revoked_sent`. Codes and game ids only: never a session id, lease, token, cookie, email, or a user id beside a session. None is a `game.finished` outbox event; a durable control-change event is GAME-CONTROL-EVENT-001.

### Tests

- **`tests/game-access` (project `game-access` in `pnpm test`, 49 tests):** `core-control.test.ts` (TST-GACC-CORE-001 to 006), `runtime-control.test.ts` (TST-GACC-RT-001 to 006: synchronous refusal after a queued rotation, the new lease admitted while its rotation is queued, the cold-writer check, a no-op apply, rotation during a recovery pause, `replayCommand`), `control-service.test.ts` (TST-GACC-SVC-001 to 019 and TST-GACC-ASSIGN-001 to 009, over an in-memory store with PostgreSQL semantics), `edge-control.test.ts` (TST-GACC-EDGE-001 to 009 with real sockets and real HTTP login: claim protocol, `CONTROL_NOT_HELD` before the writer, takeover and notice, replay after rotation, lost notice, IDOR for a third user and a missing game, logout, disable, claim denials).
- **PostgreSQL (`pnpm test:game-access`, 6 files, 62 tests; also in `pnpm test:db`):** `migrations.db.test.ts` (TST-GACC-DB-001 to 007: up, down, up again; constraints by SQLSTATE 23514/23503/23505/23001; confirm, cascading discard, CAS, session foreign key `SET NULL`; every lookup indexed and used by the planner with sequential scans off; 8 concurrent reservations give one, 4 concurrent CAS give one; corrupt rows fail closed; a revoked holder controls nothing) and `e2e.db.test.ts` (TST-GACC-E2E-001 to 006).
- **TST-GACC-E2E-001, the 20 steps:** two accounts over real HTTP, each logged in; the trusted use case assigns and starts the game (assignment `confirmed`); both connect and `connection_ready` lists the seat; both sync without control; both claim; both move, committed to PostgreSQL; a third user is refused sync, claim, and command with no game data; white logs in again and session B syncs at sequence 2 without control; B's command is `CONTROL_NOT_HELD`; B claims; A receives `control_revoked CONTROL_TRANSFERRED`; A's command is refused before the writer (no commit); B's command is accepted; PostgreSQL shows B holding white at version 2 and the writer's stored lease equal to the record; restart in a new clock domain; B still controls and the game is paused `RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED`; B's command is not executed and a claim resumes nothing; history, position, leases, and bindings `[w-1, b-1, w-2]` survived; A reconnects, sees its seat without control, and is refused.
- **E2E-002 to 006:** logout releases control to nobody and rotates the writer's lease; disabling an account releases its seats, resigns nothing, and holds across a restart; replay after rotation over PostgreSQL (exact X answered from storage, new Y refused, then B's Y accepted); a logout racing a command and a disable racing a command both end with the seat released and the old lease refused by the writer.
- **Existing suites updated to the new contracts:** realtime tests use a test-only `GameAccessProvider` (`tests/realtime/support/static-access.ts`) that holds control from the start, so their behaviour is unchanged; TST-PROTO-012 (a client lease is length-checked, then discarded); the accounts HTTP harness's `TestGameAccess` is now a test-only `GameAccessProvider` over the same static authority (seat control itself is tested over the real `GameAccess` in `tests/game-access`); the persistence contract repository implements the `control` plan.
- **Boundaries:** TST-BOUNDARY-041 to 045 (game access sees accounts, identity, the runtime, and `node:crypto` only; its store adapter has no transport, core, or edge; accounts and identity know nothing of games; the edge uses game access but never its store, and the core and runtime never see game access; clients import neither). `writer_bypass` unchanged.

### Dependencies

No new third-party dependency. New workspace packages `@chess-one/game-access`, `@chess-one/game-access-persistence`, `@chess-one/tests-game-access`; the edge depends on `@chess-one/game-access`. New script `test:game-access` (`vitest.game-access.config.ts`).

### Gates (Node 24.21.0, pnpm 12.7.0, TypeScript 7.0.2, PostgreSQL 18, database `chess_one_test`)

- typecheck, lint, format:check, check:boundaries, test, test:rules, check, audit, test:db, test:realtime, test:auth, and the new test:game-access all pass (exit 0).
- **Normal suite:** 61 files, 748 passed. By project: rules 291, boundaries 46, live-game 117, persistence 49, realtime 95, accounts 101, game-access 49.
- **`test:game-access`:** 6 files, 62 passed. **`test:db`:** 6 files, 51 passed. **`test:realtime`:** 9 files, 101 passed. **`test:auth`:** 8 files, 121 passed. **`test:rules`:** 291 passed.
- 0 failed, 0 skipped, 0 blocked, 0 todo. **Audit:** no known vulnerabilities.
- No `any`, cast, `as const`, `ts-ignore`, `ts-expect-error`, `biome-ignore`, silent catch, unbounded map, plaintext secret, or real password was added.

### Resolved and remaining

- **Resolved:** AUTH-GAME-ACCESS-001 (production game access from durable assignments), LIVE-MULTI-CONNECTION-001 (one controlling session per seat, explicit claim, lease rotation).
- **Still open:** LIVE-VIEW-ONLY-001, LIVE-WRITER-OWNERSHIP-001, LIVE-RECOVERY-RESUME-001, AUTH-REVOCATION-BROADCAST-001 (another process's revocation releases control only when this process learns of it), AUTH-RATE-LIMIT-DISTRIBUTED-001 (claim limits are per process too), and the Batch 10/10.1 gaps. New: GAME-CONTROL-EVENT-001, GAME-ACCESS-CREATION-API-001, GAME-CONTROL-REPLAY-RECONNECT-001 (resolved by Batch 11.1).

## PHASE 1 / BATCH 11.1 — DURABLE HISTORICAL REPLAY AFTER CONTROL TRANSFER

Owner-authorized (2026-09-29). HEAD stays `53d85e24cd25df3aa2f7a339c7ad47bd3100342a`; Batch 11 and 11.1 are uncommitted and pending review. No remote, no push, no ZIP, no Batch 12. Changelog section 23 (GACC-015, GACC-016).

### Root cause

The fingerprint of a bound command includes the control lease it was admitted under (LIVE-CONTRACT-005), and the browser never sends a lease. In Batch 11 only the edge could rebuild a former controller's fingerprint, from its per-connection memory of the former lease and the last 64 ids sent under it. That memory died with the connection, so after a reconnect, a second session, or a restart an exact resend was `CONTROL_NOT_HELD`.

### Design

- **The lease comes from the binding itself.** A stored fingerprint is canonical text, `name gameId lease …`, and none of the first three fields can contain a space (command names are constants; game ids and leases are restricted identifiers). `boundLease(fingerprint)` reads the third field and checks it is a lease. `historicalReplay(state, participant, command)` (live-game core, `control-lease.ts`) finds the binding by the participant's own seat and the command id, rebuilds the command with the bound lease, parses it, and answers `replayed` only if `fingerprintOf` of the rebuilt command equals the stored text exactly. An altered command, or a stored lease field that is not a lease, is `identity_conflict`; no binding, another seat, another player, another game, or a mismatched `actorId` is `not_bound`. The fingerprint itself is unchanged, so existing bindings keep working and no migration was needed.
- **Authority before lookup.** `SessionGameAuthority.replayAccess(gameId)` (game access) resolves the seat freshly from the assignment, then checks `isSessionActive` in the accounts store: `player {seat}`, `denied`, `session_ended`, or `unavailable`. The control record is not read; control is neither needed nor granted.
- **Writer.** `replayCommand(participant, command, reply)` takes a `GameParticipant` (game, player, seat; no lease) and a `LeaselessCommand`, queues a read-only job, loads the stored game (`loadForWriter`), and runs `historicalReplay`. Outcomes: `decided` (fact `command_replayed`), `control_not_held` (`command_refused_control`), `identity_conflict` (new fact `replay_identity_conflict`), `recovery_required`, `unavailable`. It never stamps, decides, commits, or schedules.
- **Edge.** `connection.ts` sends a command without control, or one the writer refuses `control_not_held` (at ingress or from a cold writer), to `#historical`: `replayAccess`, then the writer's `replayCommand` with the seat game access returned. Mapping: `decided` → `command_response` (`replayed: true`); `control_not_held` or `session_ended` → `CONTROL_NOT_HELD`; `identity_conflict` → `request_failed INVALID_COMMAND_IDENTITY` (not retryable); `denied` → `GAME_ACCESS_DENIED`; `unavailable` → `TEMPORARILY_UNAVAILABLE`. `seat-control.ts` no longer remembers sent ids or former leases (`REMEMBERED_COMMANDS`, `rememberSent`, `replayLease` removed). `ClientCommand` is now the runtime's `LeaselessCommand`.
- **Connection memory is no longer authoritative, or used at all, for replay.** The only authority is the stored binding.
- **Current controller (GACC-016; superseded by Batch 11.2, which resolved it).** Unchanged: a controller under a newer lease resending an id bound under an earlier lease gets `InvalidCommandIdentity` from the core (catalog 2.6.2). Recorded as an owner review point.
- **Cost.** A command without control costs one assignment read, one session read, and one read-only writer job (a game load), bounded by the connection's inbound token bucket and the writer's queue limit.

### Files

- `server/live-game/src`: `command-identity.ts` (`boundLease`), `commands.ts` (`LeaselessCommand`), `control-lease.ts` (`historicalReplay`, `GameParticipant`, `HistoricalReplay`; `replayOnly` removed), `index.ts`.
- `server/live-game-runtime/src`: `writer-port.ts`, `writer-runtime.ts` (replay job and outcomes), `facts.ts` (`replay_identity_conflict`), `index.ts`.
- `server/game-access/src`: `values.ts` (`ReplayAccess`), `control.ts` (`replayAccess`), `session-authority.ts`, `game-access.ts`, `index.ts`.
- `server/edge/src`: `connection.ts`, `seat-control.ts`, `protocol/client-messages.ts`, `protocol/server-messages.ts` (`INVALID_COMMAND_IDENTITY`).
- Tests: `tests/game-access/core-control.test.ts`, `runtime-control.test.ts`, `control-service.test.ts`, `edge-control.test.ts`, `e2e.db.test.ts`; `tests/realtime/support/static-access.ts` (`replayAccess`).
- Docs: changelog sections 22 (GACC-005 note, GACC-011 superseded, GAME-CONTROL-REPLAY-RECONNECT-001 resolved) and 23; catalog 11.3, 11.6, 13 (intro), 13.1, 13.3; the traceability note; the v6 status line.
- No migration, schema, dependency, or boundary rule change.

### Tests

- **Core:** TST-GACC-CORE-004 (exact replay from the binding after a rotation and a later move; a stale client lease is ignored), 007 (altered move, promotion, or command kind under a bound id is `identity_conflict`; other game, unbound, or malformed id is `not_bound`), 008 (only the seat's player reads its bindings: the opponent seat, another player, a stranger, another game, a foreign `actorId`), 009 (offer, response, claim with intended move, and resignation each rebuilt exactly; altered decision, offer id, or intended square conflict), 010 (`boundLease`; a damaged stored fingerprint is a conflict, never a guess).
- **Runtime:** TST-GACC-RT-006 (replay after rotation; unbound id and the other seat are `control_not_held`; no commit), 007 (`identity_conflict` fact; the stored state, bindings, leases, commits, and scheduled wakes are unchanged after replays, with the clock advanced), 008 (a new registry over the same store, i.e. a restart, replays from the binding alone).
- **Service:** TST-GACC-SVC-020 (`replayAccess`: both players' seats without control and without changing the control record; stranger and missing game denied; store outage unavailable; logged-out and expired sessions `session_ended`; another active session of the player still allowed).
- **Edge, real sockets and HTTP login:** TST-GACC-EDGE-004 (A, D, E, I on the same connection: replay equal to the original but for `replayed`; altered → `INVALID_COMMAND_IDENTITY`; new Y → `CONTROL_NOT_HELD`; stored state, commits, and wakes unchanged; no lease or fingerprint on the wire), 010 (B: the same session reconnects and replays; after logout the socket closes and the cookie is refused 401), 011 (C: a new session of the same user replays after the old one logged out; control record untouched), 012 (F, G: the opponent, and a second session of the opponent, get `CONTROL_NOT_HELD` with no response data; a third user gets `GAME_ACCESS_DENIED`), 013 (GACC-016: the new controller's resend of X is `InvalidCommandIdentity`, nothing changes). TST-GACC-EDGE-002, 003, 005 updated: a command without control now reaches the writer as a read-only lookup (runtime fact counts), still with nothing admitted.
- **PostgreSQL:** TST-GACC-E2E-007 (H: after a full stack restart, in the same clock domain and in a new one, the same session and a new session replay X; altered X conflicts; Y is refused; the opponent and a third user learn nothing; the `live_games` row, binding and outbox counts, seat-control rows, sequence, bindings, and clock are unchanged; no commit). E2E-001 step 13 updated the same way as EDGE-002.

### Gates (Node 24.21.0, pnpm 12.7.0, TypeScript 7.0.2, PostgreSQL 18, database `chess_one_test`)

- typecheck, lint, format:check, check:boundaries, test, test:rules, check, audit, test:db, test:realtime, test:auth, and test:game-access all pass (exit 0), run one at a time.
- **Normal suite:** 61 files, 759 passed (game-access 60; other projects unchanged). **`test:game-access`:** 6 files, 74 passed. **`test:db`:** 6 files, 52 passed. **`test:realtime`:** 9 files, 101 passed. **`test:auth`:** 8 files, 121 passed. **`test:rules`:** 24 files, 291 passed.
- 0 failed, 0 skipped, 0 blocked, 0 todo. **Audit:** no known vulnerabilities.
- No `any`, cast, `as const`, `ts-ignore`, `ts-expect-error`, `biome-ignore`, silent catch, unbounded map, or secret was added.

### Resolved and remaining

- **Resolved:** GAME-CONTROL-REPLAY-RECONNECT-001.
- **Owner review point:** GACC-016 (the current controller stays under LIVE-CONTRACT-005). Resolved by Batch 11.2.
- **New, narrow:** LIVE-RECOVERY-PAUSED-REPLAY-001 (a writer paused for an infrastructure failure answers a replay `recovery_required`).
- **Unchanged:** every Batch 11 gap other than the one resolved; binding retention (LIVE-PERSIST-003) bounds how far back replay reaches.

## PHASE 1 / BATCH 11.2 — UNIFY HISTORICAL COMMAND REPLAY ACROSS CONTROL STATES

Owner-authorized (2026-09-29). Local only: no commit, no push, no deployment, no change to the remote, CI/CD (the repository has none), DNS, the site, or any credential. Batch 11 and 11.1 had been committed and pushed at the owner's request just before (`ff656fa`), so HEAD is `ff656fa`; the batch brief's expected HEAD `53d85e2` no longer matches, and history was not rewritten. Changelog section 24.

### Problem

After Batch 11.1 a session without control replayed an exact old command, but the session that controls the seat under a newer lease got `InvalidCommandIdentity` for the same resend, because the core's identity step compared the stored fingerprint with one built under the caller's current lease.

### Change

- `command-identity.ts`: `matchesBinding(binding, command)` rebuilds the command's fingerprint under the lease stored in the binding (`boundLease`) and requires exact equality with the stored text.
- `process-command.ts` step 3 uses `matchesBinding` instead of comparing with the current-lease fingerprint; a new command's fingerprint is still built under the current lease (after the unchanged lease check of step 2).
- `control-lease.ts`: `historicalReplay` uses the same `matchesBinding`, so the controller path and the historical path apply one rule.
- No edge, runtime, game-access, persistence, protocol, or schema change: a controller's resend was already admitted under its current lease and reaches step 3; a command not admitted under the current lease already goes to the historical lookup of Batch 11.1.

### Rule

For any active session of the seat's assigned player: binding for (game, own seat, command id) first; exact match under the stored lease → stored response, `replayed: true`, nothing admitted or written; other command under that id → `InvalidCommandIdentity` (a `command_response` for the controller, `request_failed INVALID_COMMAND_IDENTITY` for a session without control); no binding → `CONTROL_NOT_HELD` without control, the normal path with control. The current lease authorizes new commands only; an old lease never does.

### Tests

- Rewritten: TST-LIVE-100 (controller under a replacement lease replays the old command; altered payload conflicts; the old lease is still `Unauthorized`), TST-GACC-EDGE-013 (B, C, D: current controller exact replay, altered → `InvalidCommandIdentity`, then a new command `Accepted` and bound; stored state, commits, and wakes unchanged across the replays; no lease or fingerprint on the wire).
- New: TST-GACC-CORE-011 (bindings made under leases A and B both replay under lease C; the new binding carries the then-current lease), TST-GACC-RT-009 (controller replay through `submitCommand` with the clock advanced: stored state, commits, wakes unchanged; altered → `InvalidCommandIdentity`).
- Extended: TST-GACC-E2E-007 (I, J: after a restart in the same and in a new clock domain the current controller replays X and gets `InvalidCommandIdentity` for altered X; the `live_games` row, binding and outbox counts, seat rows, sequence, bindings, and clock are unchanged; no commit).
- Unchanged and still passing: A (TST-GACC-EDGE-004), E and F (TST-GACC-EDGE-011), G and H (TST-GACC-EDGE-012), same-session reconnect (TST-GACC-EDGE-010).

### Gates (Node 24.21.0, pnpm 12.7.0, TypeScript 7.0.2, PostgreSQL 18, database `chess_one_test`)

- typecheck, lint, format:check, check:boundaries, test, test:rules, check, audit, test:db, test:realtime, test:auth, and test:game-access all pass (exit 0), run one at a time.
- **Normal suite:** 61 files, 761 passed. **`test:game-access`:** 6 files, 76 passed. **`test:db`:** 6 files, 52 passed. **`test:realtime`:** 9 files, 101 passed. **`test:auth`:** 8 files, 121 passed. **`test:rules`:** 24 files, 291 passed.
- 0 failed, 0 skipped, 0 blocked, 0 todo. **Audit:** no known vulnerabilities. No dependency added. No `any`, cast, `as const`, `ts-ignore`, `ts-expect-error`, `biome-ignore`, or silent catch added.

### Status

GACC-016 RESOLVED; LIVE-CONTRACT-005 amended; GAME-CONTROL-REPLAY-RECONNECT-001 stays RESOLVED (no connection memory reintroduced); LIVE-RECOVERY-PAUSED-REPLAY-001 stays OPEN.

## PHASE 1 / BATCH 11.3 — REMOVE AUTHORITATIVE RECEIPT FROM CURRENT-CONTROLLER HISTORICAL REPLAY

Owner-authorized (2026-09-29). Local only, on top of the uncommitted Batch 11.2: no commit, no push, no deployment, no change to the remote, DNS, the site, or any credential. HEAD stays `ff656fa`. Changelog section 25 (GACC-017).

### Root cause

A session without control replayed through the writer's read-only `replayCommand`. The controller's resend went through `submitCommand`, which read the writer's monotonic clock as the authoritative `received_at` (DEC-063) and queued the resend as a new command before any binding was known. The core found the binding only later. So the controller's historical replay was an authoritative receipt, and its identity conflict came back as a `command_response` stamped with a new receipt time.

### Change

- `server/live-game-runtime/src/writer-runtime.ts`:
  - The writer keeps `#known`, the game state it last loaded (every `loadGame`) or committed itself (every successful commit, including bind-only). This replaces the lease-only memory. It also keeps `#waiting`, a count of queued command and lookup jobs per seat and command id.
  - `submitCommand` classifies each command at ingress with no database read and no clock reading, and in each case a replay is never received:
    - id bound in `#known`: a `bound` lookup;
    - `#known` absent, or a queued job may still bind the id: an `unresolved` lookup;
    - otherwise a new command, authorized against the current lease (`CONTROL_NOT_HELD` if refused) and stamped at once.
  - A new `lookup` job, run in queue order on a fresh load:
    - bound id: replayed (`command_replayed`) or identity conflict (`replay_identity_conflict`);
    - unbound id without control: `control_not_held`;
    - unbound id with control on a game whose clock runs in this domain: not received (`command_not_received`, `temporarily_unavailable`);
    - otherwise received after the load and processed normally, charging nothing because no clock runs.
- `writer-port.ts`: `CommandIngress` gains `CommandLookup` (`receivedAt: null`, `lookup: "bound" | "unresolved"`); `CommandOutcome` gains `identity_conflict`. `facts.ts`: `command_not_received`; `writer_fault.job` includes `lookup`.
- `server/edge/src/connection.ts`: a lookup records `command_lookup`, and only a stamped command records `command_submitted`. `identity_conflict` is sent as `request_failed INVALID_COMMAND_IDENTITY`, the same answer a session without control gets.
- No change to the live-game core, game-access, persistence, schema, protocol message set, or dependencies.

### First load and restart

- An unloaded writer never stamps and never treats an id as new. A bound id is replayed from the fresh load. A new id on a game whose clock runs here is not received (resend). When no clock runs here, it is received after the load, which costs nothing.
- In production a running game enters play through `startGame`, which loads its writer before returning (LIVE-WRITER-ACTIVATION-001), and a running writer never retires (TST-RT-016). So every command to a running game meets a loaded writer and is stamped immediately (TST-GACC-RCPT-006).
- A restarted process is a new clock domain, so the games it finds are recovery-paused. There, a bound id is a lookup (TST-GACC-RCPT-005), and a new id gets `recovery_required` (TST-GACC-RCPT-007).

### Tests

- New, TST-GACC-RCPT-001 to 008, covering required cases A to G. `ManualClock.reads` counts clock readings deterministically; there are no timing races.
- Updated:
  - TST-GACC-RT-003, 009 and TST-GACC-EDGE-013 (the controller's conflict is `request_failed INVALID_COMMAND_IDENTITY` with no clock reading and no `command_submitted`);
  - TST-GACC-E2E-007 (same over PostgreSQL);
  - TST-RT-004 (an in-flight duplicate is an `unresolved` lookup) and TST-EDGE-041 (facts).
- Test setup: tests that stored a running game in the current clock domain and then sent commands to a writer that had never loaded it now activate the writer first (`storeInPlay`), as `startGame` does. This covers writer-runtime, writer-ownership, infrastructure-pause, writer-activation, edge, runtime-control, and realtime.db (TST-RT-DB-005's second process). Without that step, those tests would now get the fail-safe answer.

### Gates (Node 24, pnpm 12.7.0, TypeScript 7.0.2, PostgreSQL 18, database `chess_one_test`)

- All 12 gates pass (exit 0), run one at a time: typecheck, lint, format:check, check:boundaries (251 files), test, test:rules, check, audit, test:db, test:realtime, test:auth, and test:game-access.
- Test counts:
  - Normal suite: 61 files, 769 passed.
  - `test:game-access`: 6 files, 84 passed.
  - `test:db`: 6 files, 52 passed.
  - `test:realtime`: 9 files, 101 passed.
  - `test:auth`: 8 files, 121 passed.
  - `test:rules`: 24 files, 291 passed.
- 0 failed, 0 skipped, 0 blocked, 0 todo.
- Audit: no known vulnerabilities. No dependency added. No `any`, cast, `as const`, `ts-ignore`, `ts-expect-error`, `biome-ignore`, or silent catch added.

### Status

GACC-017 RESOLVED (pending review). GACC-016 and GAME-CONTROL-REPLAY-RECONNECT-001 stay RESOLVED. LIVE-CONTRACT-005 is not amended again. LIVE-RECOVERY-PAUSED-REPLAY-001 stays OPEN.
