# Traceability Matrix v2 / مصفوفة التتبع — الإصدار 2

**Supersedes for implementation / يحل محل التنفيذ:** section 48 in the preserved v4 text. That section mapped architecture requirements to MOD-014 and social requirements to the tournament module. Do not use it.

**Implementation status / حالة التنفيذ:** `NOT_STARTED` unless a row says `PARTIAL`. Phase 1 Batch 1 (P1-B1) advanced six rows partially; Batch 1.1 (P1-B1.1) hardened three of them without changing their status; Batch 2 (P1-B2) advanced FR-P06-005 to PARTIAL; Batch 3 (P1-B3) and Batch 4 (P1-B4) extended FR-P06-005 without changing its status; Batch 5 (P1-B5, reviewed and committed) advanced FR-GM-001, 002, 003, 006, 007, 009, and 010 to PARTIAL with the in-memory live-game authority in `server/live-game`; Batch 6 (P1-B6, reviewed and committed) extended FR-GM-002, 003, and 009 with timeout and resignation adjudication by one-sided mating capability, and advanced FR-P06-007 to PARTIAL; Batch 6.1 (P1-B6.1, reviewed and committed) made that capability depend on the position alone and resolved LIVE-CONTRACT-006 and LIVE-RESIGN-001, with no status change; Batch 7 (P1-B7, reviewed and committed) extended FR-GM-003, FR-GM-009, and FR-P06-007 with the draw-offer state machine, with no status change; Batch 8 (P1-B8, uncommitted pending review) advanced FR-ARC-003 to PARTIAL with the PostgreSQL/Kysely persistence foundation and transactional outbox, and extended FR-GM-002, FR-GM-009, and FR-GM-010 without changing their status; its PostgreSQL integration tests are BLOCKED by the environment; Batch 8.1 (P1-B8.1, uncommitted pending review) ran them on a local PostgreSQL 18.6 test database, where they pass, and resolved LIVE-RECOVERY-CLOCK-001 (recovery pause), with no status change; Batch 9 (P1-B9, uncommitted pending review) added the realtime transport foundation (`server/live-game-runtime` writer registry and `server/edge` Fastify + WebSocket endpoint, protocol `chess_one.realtime.v1`), advanced FR-GM-004 and FR-P0-004 to PARTIAL, and extended FR-GM-002, FR-GM-003, FR-GM-006, and FR-P0-005; see `PHASE_1_IMPLEMENTATION_LOG.md`. No row is complete.

**Rule / القاعدة:** a cell is `TBD` when this rebuild cannot prove the link from the module map, the named page list, a v5 decision, or a v5 contract. `TBD` is not a guess.

Section 48 feature ids such as `FTR-ARC-001` are not reused, because they were attached to the wrong module.

| Requirement ID | Domain / Module | Feature / Use Case | Page | Entity | Contract / API / Event | Test Class | Decision dependencies | Implementation status |
|---|---|---|---|---|---|---|---|---|
| FR-AD-001 | MOD-010 adventure scope (F) | TBD | TBD | TBD | TBD | TBD | F backlog; DEC-052 | NOT_STARTED |
| FR-AD-002 | MOD-010 adventure scope (F) | TBD | TBD | TBD | TBD | TBD | F backlog; DEC-052 | NOT_STARTED |
| FR-AD-003 | MOD-010 adventure scope (F) | TBD | TBD | TBD | TBD | TBD | F backlog; DEC-052 | NOT_STARTED |
| FR-AD-004 | MOD-010 adventure scope (F) | TBD | TBD | TBD | TBD | TBD | F backlog; DEC-052 | NOT_STARTED |
| FR-AD-005 | MOD-010 adventure scope (F) | TBD | TBD | TBD | TBD | TBD | F backlog; DEC-052 | NOT_STARTED |
| FR-AD-006 | MOD-010 adventure scope (F) | TBD | TBD | TBD | TBD | TBD | F backlog; DEC-052 | NOT_STARTED |
| FR-AD-007 | MOD-010 adventure scope (F) | TBD | TBD | TBD | TBD | TBD | F backlog; DEC-052 | NOT_STARTED |
| FR-AD-008 | MOD-010 adventure scope (F) | TBD | TBD | TBD | TBD | TBD | F backlog; DEC-052 | NOT_STARTED |
| FR-AD-009 | MOD-010 adventure scope (F) | TBD | TBD | TBD | TBD | TBD | F backlog; DEC-052 | NOT_STARTED |
| FR-AD-010 | MOD-010 adventure scope (F) | TBD | TBD | TBD | TBD | TBD | F backlog; DEC-052 | NOT_STARTED |
| FR-AI-001 | MOD-007 AI | TBD | TBD | TBD | TBD | TST-SECURITY | DEC-011; DEC-047 | NOT_STARTED |
| FR-AI-002 | MOD-007 AI | TBD | TBD | TBD | TBD | TST-SECURITY | DEC-011; DEC-047 | NOT_STARTED |
| FR-AI-003 | MOD-007 AI | UC-AI-04 | PAGE-006 | TBD | DEC-047 server denial | TST-SECURITY | DEC-011; DEC-047 | NOT_STARTED |
| FR-AI-004 | MOD-007 AI | UC-AI-04 | PAGE-006 | TBD | DEC-047 server denial | TST-SECURITY | DEC-011; DEC-047 | NOT_STARTED |
| FR-AI-005 | MOD-007 AI | TBD | TBD | TBD | TBD | TST-SECURITY | DEC-011; DEC-047 | NOT_STARTED |
| FR-AI-006 | MOD-007 AI | TBD | TBD | GameResult; Wallet; RatingState | TBD | TST-SECURITY | DEC-011; DEC-047 | NOT_STARTED |
| FR-AI-007 | MOD-006 Player Intelligence | UC-AI-05 | TBD | TBD | TBD | TST-SECURITY | DEC-011; DEC-047 | NOT_STARTED |
| FR-AI-008 | MOD-006 Player Intelligence | UC-AI-06 | TBD | TBD | TBD | TST-SECURITY | DEC-011; DEC-047 | NOT_STARTED |
| FR-AI-009 | MOD-006 Player Intelligence | UC-AI-07 | TBD | TBD | TBD | TST-SECURITY | DEC-011; DEC-047 | NOT_STARTED |
| FR-AI-010 | MOD-006 Player Intelligence | UC-AI-09 | TBD | TBD | TBD | TST-SECURITY | DEC-011; DEC-047 | NOT_STARTED |
| FR-AI-011 | MOD-007 AI | TBD | PAGE-005 | TBD | TBD | TST-SECURITY | DEC-011; DEC-047 | NOT_STARTED |
| FR-AI-012 | MOD-007 AI | TBD | TBD | TBD | TBD | TST-SECURITY | DEC-011; DEC-047 | NOT_STARTED |
| FR-AI-013 | MOD-007 AI | UC-AI-10 | TBD | TBD | TBD | TST-SECURITY | DEC-011; DEC-047 | NOT_STARTED |
| FR-AI-014 | MOD-007 AI | UC-AI-11 | TBD | TBD | TBD | TST-SECURITY | DEC-011; DEC-047 | NOT_STARTED |
| FR-ARC-001 | Architecture cross-cutting | TBD | TBD | TBD | TBD | TST-FAILURE | DEC-004; DEC-033; DEC-048 | NOT_STARTED |
| FR-ARC-002 | Architecture cross-cutting | TBD | TBD | TBD | TBD | TST-FAILURE | DEC-004; DEC-033; DEC-048 | NOT_STARTED |
| FR-ARC-003 | Architecture cross-cutting | UC-GM-10 | TBD | GameResult | game.finished.v1; outbox | TST-CONTRACT | DEC-004; DEC-033; DEC-048; DEC-040 | PARTIAL: `game.finished.v1` is written to `outbox_events` in the same PostgreSQL transaction as the state change and binding, with a durable `event_id` assigned at the persistence boundary and a uniqueness constraint per aggregate sequence and event type (LIVE-CONTRACT-003) (P1-B8). *Later status (P1-B8.1):* verified on a local PostgreSQL 18.6 test database: one row per finish across replays and restarts, `gen_random_uuid()` ids returned by the commit, and full rollback on failure. No dispatcher, publication, broker, or consumers |
| FR-ARC-004 | Architecture cross-cutting | TBD | TBD | all owned entities | TBD | TST-SECURITY | DEC-004; DEC-033; DEC-048 | NOT_STARTED |
| FR-ARC-005 | Architecture cross-cutting | UC-TS-05 | TBD | TBD | TBD | TST-FAILURE | DEC-004; DEC-033; DEC-048 | NOT_STARTED |
| FR-ARC-006 | Architecture cross-cutting | TBD | TBD | TBD | TBD | TST-CONTRACT | DEC-004; DEC-033; DEC-048 | NOT_STARTED |
| FR-ARC-007 | Architecture cross-cutting | TBD | TBD | TBD | TBD | TST-CONTRACT | DEC-004; DEC-033; DEC-048 | NOT_STARTED |
| FR-ARC-008 | Architecture cross-cutting | TBD | TBD | TBD | TBD | TST-CONTRACT | DEC-004; DEC-033; DEC-048 | NOT_STARTED |
| FR-CL-001 | MOD-010 Chess Land | TBD | PAGE-040 | TBD | TBD | TBD | DEC-002; DEC-028 | NOT_STARTED |
| FR-CL-002 | MOD-010 Chess Land | TBD | PAGE-040 | TBD | TBD | TBD | DEC-002; DEC-028 | NOT_STARTED |
| FR-CL-003 | MOD-010 Chess Land | TBD | PAGE-042 | TBD | TBD | TBD | DEC-002; DEC-028 | NOT_STARTED |
| FR-CL-004 | MOD-010 Chess Land | TBD | PAGE-042 | TBD | TBD | TBD | DEC-002; DEC-028 | NOT_STARTED |
| FR-CL-005 | MOD-010 Chess Land | TBD | PAGE-042 | TBD | TBD | TBD | DEC-002; DEC-028 | NOT_STARTED |
| FR-CL-006 | MOD-010 Chess Land | TBD | PAGE-040 | TBD | TBD | TBD | DEC-002; DEC-028 | NOT_STARTED |
| FR-CL-007 | MOD-010 Chess Land | TBD | PAGE-043 | TBD | TBD | TBD | DEC-002; DEC-028 | NOT_STARTED |
| FR-CL-008 | MOD-010 Chess Land | TBD | PAGE-040 | TBD | TBD | TBD | DEC-002; DEC-028 | NOT_STARTED |
| FR-CL-009 | MOD-010 Chess Land | TBD | PAGE-041 | TBD | TBD | TBD | DEC-002; DEC-028 | NOT_STARTED |
| FR-CO-001 | UX experience cross-cutting | TBD | TBD | TBD | TBD | TBD | DEC-009 | NOT_STARTED |
| FR-CO-002 | UX experience cross-cutting | TBD | TBD | TBD | TBD | TBD | DEC-009 | NOT_STARTED |
| FR-CO-003 | UX experience cross-cutting | TBD | TBD | TBD | TBD | TBD | DEC-009 | NOT_STARTED |
| FR-CO-004 | MOD-012 Collectibles / presentation | TBD | TBD | TBD | TBD | TBD | DEC-009 | NOT_STARTED |
| FR-CO-005 | MOD-012 Collectibles / presentation | TBD | TBD | TBD | TBD | TBD | DEC-009 | NOT_STARTED |
| FR-CO-006 | MOD-012 Collectibles / presentation | TBD | TBD | TBD | TBD | TBD | DEC-009 | NOT_STARTED |
| FR-CO-007 | MOD-012 Collectibles / presentation | TBD | TBD | TBD | TBD | TBD | DEC-009 | NOT_STARTED |
| FR-CO-008 | MOD-012 Collectibles / presentation | TBD | TBD | TBD | TBD | TBD | DEC-009 | NOT_STARTED |
| FR-CO-009 | MOD-012 Collectibles / presentation | TBD | TBD | TBD | TBD | TBD | DEC-009 | NOT_STARTED |
| FR-CO-010 | MOD-012 Collectibles / presentation | TBD | TBD | TBD | TBD | TBD | DEC-009 | NOT_STARTED |
| FR-CO-011 | MOD-012 Collectibles / presentation | TBD | TBD | TBD | TBD | TBD | DEC-009 | NOT_STARTED |
| FR-CO-012 | MOD-012 Collectibles | TBD | PAGE-049 | TBD | TBD | TBD | DEC-009 | NOT_STARTED |
| FR-CP-001 | MOD-004 Competition | TBD | PAGE-037; PAGE-038 | TBD | TBD | TBD | DEC-037 | NOT_STARTED |
| FR-CP-002 | MOD-004 Competition | UC-CP-05 | PAGE-039 | TBD | TBD | TBD | DEC-037 | NOT_STARTED |
| FR-CP-003 | MOD-004 Competition | UC-CP-01 | TBD | TBD | TBD | TBD | DEC-037 | NOT_STARTED |
| FR-CP-004 | MOD-004 Competition | TBD | TBD | TBD | TBD | TBD | DEC-037 | NOT_STARTED |
| FR-CR-001 | MOD-013 Creator | TBD | PAGE-050 | TBD | TBD | TST-SECURITY | DEC-011 privacy consent | NOT_STARTED |
| FR-CR-002 | MOD-013 Creator | TBD | PAGE-050 | TBD | TBD | TST-SECURITY | DEC-011 privacy consent | NOT_STARTED |
| FR-CR-003 | MOD-013 Creator | TBD | PAGE-050; PAGE-051 | TBD | TBD | TST-SECURITY | DEC-011 privacy consent | NOT_STARTED |
| FR-CR-004 | MOD-013 Creator | TBD | TBD | TBD | TBD | TST-SECURITY | DEC-011 privacy consent | NOT_STARTED |
| FR-EC-001 | MOD-012 Economy | TBD | PAGE-047 | TBD | TBD | TST-CONTRACT | DEC-008; DEC-024 | NOT_STARTED |
| FR-EC-002 | MOD-012 Economy | TBD | TBD | TBD | TBD | TST-CONTRACT | DEC-008; DEC-024 | NOT_STARTED |
| FR-EC-003 | MOD-012 Economy | TBD | PAGE-047 | LedgerEntry | TBD | TST-CONTRACT | DEC-008; DEC-024 | NOT_STARTED |
| FR-EC-004 | MOD-012 Economy | TBD | TBD | TBD | TBD | TST-CONTRACT | DEC-008; DEC-024 | NOT_STARTED |
| FR-EC-005 | MOD-012 Economy | TBD | TBD | TBD | TBD | TST-CONTRACT | DEC-008; DEC-024 | NOT_STARTED |
| FR-EC-006 | MOD-012 Economy | TBD | TBD | TBD | TBD | TST-CONTRACT | DEC-008; DEC-024 | NOT_STARTED |
| FR-EC-007 | MOD-012 Economy | TBD | TBD | TBD | TBD | TST-CONTRACT | DEC-008; DEC-024 | NOT_STARTED |
| FR-EC-008 | MOD-012 Economy | TBD | PAGE-046 | TBD | TBD | TST-CONTRACT | DEC-008; DEC-024 | NOT_STARTED |
| FR-EC-009 | MOD-012 Economy | TBD | PAGE-046; PAGE-047 | Payment; LedgerEntry | TBD | TST-CONTRACT | DEC-008; DEC-024 | NOT_STARTED |
| FR-EC-010 | MOD-012 Economy | TBD | PAGE-046 | TBD | TBD | TST-CONTRACT | DEC-008; DEC-024 | NOT_STARTED |
| FR-GM-001 | MOD-002 Live Game Authority | TBD | PAGE-005; PAGE-006 | TBD | TBD | TST-STATE | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | PARTIAL: one generic two-player live game aggregate with caller-supplied game, player, and lease ids and a trusted start-position seam (P1-B5). No game-type catalogue, matchmaking, guest, bot, tournament, correspondence, team, or simultaneous play |
| FR-GM-002 | MOD-002 Live Game Authority | TBD | PAGE-006 | ClockState | TBD | TST-CLOCK | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | PARTIAL: deterministic server clock in integer ms, charged to trusted writer-domain `received_at` (DEC-061, DEC-063); at-or-before-deadline receipt is timely; late commands are not applied and commit the flag (P1-B5); the flag is adjudicated by the opponent's one-sided capability: win on time, draw `timeout_no_mate`, or MATING_POSSIBILITY_UNRESOLVED when UNKNOWN, on both the late-command and writer-deadline paths (P1-B6). No persistence, recovery, transport, or real ingress stamping. *Later status (P1-B8):* the clock is persisted with the id of the writer clock domain that stored it; a running clock stored by another domain is not resumed (LIVE-RECOVERY-CLOCK-001, OPEN), and only stored responses replay. Transport and real ingress stamping are not built. *Later status (P1-B8.1):* LIVE-RECOVERY-CLOCK-001 RESOLVED: on writer clock-domain loss the game is recovery-paused at its committed balances, and no player is charged for downtime; the resume operation is LIVE-RECOVERY-RESUME-001 (OPEN). Status unchanged. *Later status (P1-B9):* real ingress stamping is built: `received_at` is the game writer's monotonic clock reading when it accepts a command into its bounded FIFO, before any queue wait (LIVE-RT-002); the writer arms `deadline + 1` wake-ups that stamp their own check and share the FIFO, so a receipt at the deadline is timely and the timer race is decided by stamp order (LIVE-RT-005; TST-RT-005 to 010, TST-EDGE-026). A command refused while the database is down is not received, and its retry is charged to the retry's receipt (LIVE-RETRY-RECEIPT-001, OPEN). Status unchanged. *Later status (P1-B9.1):* LIVE-RETRY-RECEIPT-001 RESOLVED: a persistence failure (or a writer fault) pauses play at the last durably committed balances. No downtime is charged, there is no deadline check or retry while paused, and nothing resumes automatically (TST-RT-PAUSE-001 to 008, TST-RT-DB-002). LIVE-WRITER-ACTIVATION-001 RESOLVED: every running game is watched by an activated writer or paused (TST-RT-ACT-001 to 008, TST-RT-DB-004). Status unchanged. *Later status (P1-B9.2):* a concurrency conflict pauses the game as `CONCURRENCY_OWNERSHIP_UNCERTAIN` and stops its writer, with no automatic re-activation, overwrite, retry, or charge (TST-RT-013, TST-RT-OWN-001 to 004, TST-EDGE-032, TST-RT-DB-005). A create reported failed is reconciled by a fresh read: stored (paused), not stored (reservation released), or unknown (`CREATE_RECONCILIATION_REQUIRED`, no play, no timer) (TST-RT-CREATE-001 to 003, TST-RT-DB-006). `WRITER_FAULT` covers unexpected exceptions only (TST-RT-OWN-005, TST-EDGE-035). Status unchanged |
| FR-GM-003 | MOD-002 Live Game Authority | TBD | PAGE-006 | Move; Game | SubmitMoveCommand.v1 | TST-RULE; TST-COMMAND | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | PARTIAL: `SubmitMoveCommand.v1` and `ClaimDrawCommand.v1` decided in memory in contract 2.3 order through the public chess-rules API: shape, authority, identity, finished, turn, sequence, deadline, legality; server SAN; idempotent replay (P1-B5). `ResignGameCommand.v1` on either turn, with the same authority, identity, sequence, deadline, and replay rules (P1-B6). `OfferDrawCommand.v1` and `RespondDrawOfferCommand.v1` with the same rules; a committed move by the recipient declines a pending offer in the same transition (P1-B7). No HTTP, WebSocket, or database. *Later status (P1-B8/B9):* persisted through PostgreSQL (P1-B8); all five commands are carried over WebSocket as `game_command` in `chess_one.realtime.v1`, strictly validated at the edge and decided unchanged by the core through one writer per game; the response goes to the issuer after the commit, then `game_update` to every subscriber (P1-B9; TST-EDGE-021 to 025, TST-RT-DB-001). Status unchanged |
| FR-GM-004 | MOD-002 Live Game Authority | UC-GM-09 | PAGE-006 | ReconnectToken; Game | reconnect state machine | TST-RECONNECT | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045; DEC-042; DEC-043 | PARTIAL (P1-B9): reconnect foundation. A disconnect changes nothing; the writer keeps the clock and deadline with no socket open; a reconnecting client sends `hello` and `sync_game` and receives `game_snapshot.v1` at the stored sequence; a resent command replays its stored response; `sync_required` tells subscribers to resync after a writer stop (TST-EDGE-024, 032, TST-RT-DB-001). No ReconnectToken, no ViewOnly or LeaseSuperseded states, no lease replacement, no abandonment; identity comes from a TrustedSessionResolver whose production implementation does not exist yet, so a production endpoint fails closed |
| FR-GM-005 | MOD-002 Live Game Authority | UC-TS-05 | PAGE-006 | TBD | TBD | TST-FAILURE | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | NOT_STARTED |
| FR-GM-006 | MOD-002 Live Game Authority | TBD | PAGE-006 | TBD | TBD | TST-STATE | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | PARTIAL: one authoritative frozen game state; each response carries the canonical FEN, clock, sequence, and status that any renderer can read (P1-B5). No 2D or 3D client, snapshot transport, or reconnect. *Later status (P1-B9):* snapshot transport: `game_snapshot.v1`, a client format separate from the stored `live_game_state.v1`, with no monotonic anchor, binding, fingerprint, lease, player id, or clock domain; per connection, no state message carries a lower sequence than one already sent (TST-PROTO-020, TST-EDGE-020, 025). No client. Status unchanged |
| FR-GM-007 | MOD-002 Live Game Authority | TBD | PAGE-006 | TBD | TBD | TST-STATE | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | PARTIAL: sudden death with equal budgets and no increment only (P1-B5). Bullet, Blitz, Rapid, and Classical presets, Fischer, Bronstein, daily, and multi-stage controls need an approved product policy |
| FR-GM-008 | MOD-002 Live Game Authority | UC-GM-08 | PAGE-007 | TBD | TBD | TST-STATE | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | NOT_STARTED |
| FR-GM-009 | MOD-002 Live Game Authority | UC-GM-10 | PAGE-006 | GameResult | game.finished.v1 | TST-CONTRACT | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | PARTIAL: `GameResult` for checkmate and rule draws, and a `game.finished.v1` domain event produced exactly once in the committing decision, never for MATING_POSSIBILITY_UNRESOLVED (DEC-064) (P1-B5). Results on `time` and by `resignation`, and draws `timeout_no_mate` and `resign_no_mate_possible`, with command or writer-deadline provenance (P1-B6). A draw `draw_agreed` by an accepted offer, with one event (P1-B7). Not published: no durable commit, outbox, `event_id`, rating, or consumers. *Later status (P1-B8):* the event is committed durably in the outbox with its state, with a durable `event_id` (LIVE-CONTRACT-003); a replay or restart never adds a second row. Still not published: no dispatcher, rating, or consumers |
| FR-GM-010 | MOD-002 Live Game Authority | TBD | PAGE-006 | GameResult | SubmitMoveCommand.v1 | TST-SECURITY; TST-COMMAND | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | PARTIAL: only server decisions set a result; no command field carries a result, identity, seat, lease, or time; a finished game is absorbing and answers `GameAlreadyFinished` (P1-B5). No persistence, so immutability holds for the in-memory state only. *Later status (P1-B8):* the stored state changes only by a compare-and-set transition decided by the core, and a stored record that fails validation is refused, never repaired. *Later status (P1-B8.1):* compare-and-set and constraint behaviour verified on a local PostgreSQL 18.6 test database |
| FR-GM-011 | MOD-002 Live Game Authority | TBD | TBD | TBD | TBD | TST-STATE | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | NOT_STARTED |
| FR-GM-012 | MOD-002 Live Game Authority | TBD | PAGE-006 | TBD | TBD | TST-STATE | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | NOT_STARTED |
| FR-ID-001 | MOD-001 Identity | UC-ID-01 | PAGE-003 | GuestIdentity | TBD | TST-SECURITY | DEC-012; DEC-038; DEC-041; DEC-041; DEC-052 | NOT_STARTED |
| FR-ID-002 | MOD-001 Identity | UC-ID-02 | TBD | GuestIdentity; Account | guest claim shape; proof method H | TST-SECURITY | DEC-012; DEC-038; DEC-041; DEC-041; proof H | NOT_STARTED |
| FR-ID-003 | MOD-001 Identity | UC-ID-04 | PAGE-024 | PlayerProfile | TBD | TST-SECURITY | DEC-012; DEC-038; DEC-041 | NOT_STARTED |
| FR-ID-004 | MOD-001 Identity | UC-ID-05 | PAGE-026 | PrivacySettings | TBD | TST-SECURITY | DEC-012; DEC-038; DEC-041 | NOT_STARTED |
| FR-ID-005 | MOD-001 Identity | UC-ID-05 | PAGE-026 | PrivacySettings | TBD | TST-SECURITY | DEC-012; DEC-038; DEC-041 | NOT_STARTED |
| FR-ID-006 | MOD-001 Identity | TBD | PAGE-027 | TBD | TBD | TST-SECURITY | DEC-012; DEC-038; DEC-041 | NOT_STARTED |
| FR-ID-007 | MOD-001 Identity | TBD | TBD | TBD | TBD | TST-RTL | DEC-012; DEC-038; DEC-041 | NOT_STARTED |
| FR-ID-008 | MOD-001 Identity | TBD | TBD | TBD | TBD | TST-A11Y | DEC-012; DEC-038; DEC-041 | NOT_STARTED |
| FR-ID-009 | MOD-001 Identity | TBD | PAGE-025 | TBD | TBD | TST-SECURITY | DEC-012; DEC-038; DEC-041 | NOT_STARTED |
| FR-ID-010 | MOD-001 Identity | TBD | PAGE-024 | TBD | TBD | TST-SECURITY | DEC-012; DEC-038; DEC-041 | NOT_STARTED |
| FR-LN-001 | MOD-008 Labs | UC-LN-01 | PAGE-017 | TBD | TBD | TBD | DEC-013 | NOT_STARTED |
| FR-LN-002 | MOD-008 Labs | TBD | PAGE-017 | TBD | TBD | TBD | DEC-013 | NOT_STARTED |
| FR-LN-003 | MOD-008 Labs | UC-LN-02 | PAGE-018 | TBD | TBD | TBD | DEC-013 | NOT_STARTED |
| FR-LN-004 | MOD-008 Labs | UC-LN-03 | PAGE-019 | TBD | TBD | TBD | DEC-013 | NOT_STARTED |
| FR-LN-005 | MOD-006 Learning | TBD | PAGE-016 | TBD | TBD | TBD | DEC-013 | NOT_STARTED |
| FR-LN-006 | MOD-006 Learning | TBD | PAGE-016 | TBD | TBD | TBD | DEC-013 | NOT_STARTED |
| FR-LN-007 | MOD-008 Labs | UC-LN-04 | PAGE-020; PAGE-021 | TBD | TBD | TBD | DEC-013 | NOT_STARTED |
| FR-LN-008 | MOD-008 Labs | UC-LN-05 | PAGE-022 | TBD | TBD | TBD | DEC-013 | NOT_STARTED |
| FR-LN-009 | MOD-008 Labs | UC-LN-06 | PAGE-023 | TBD | TBD | TBD | DEC-013 | NOT_STARTED |
| FR-NEW-001 | MOD-006 Player Intelligence | TBD | PAGE-012 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-002 | MOD-006 Player Intelligence | TBD | PAGE-012 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-003 | MOD-006 Player Intelligence | TBD | PAGE-012 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-004 | MOD-007 AI / MOD-016 for ops center | TBD | PAGE-056 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-005 | MOD-007 AI / MOD-016 for ops center | TBD | PAGE-056 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-006 | MOD-007 AI / MOD-016 for ops center | TBD | PAGE-056 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-007 | MOD-007 AI / MOD-016 for ops center | TBD | PAGE-056 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-008 | MOD-005 Analysis | TBD | PAGE-010 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-009 | MOD-005 Analysis | UC-AI-01 | PAGE-009 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-010 | MOD-005 Analysis | TBD | PAGE-010 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-011 | MOD-005 Analysis | TBD | PAGE-010 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-012 | MOD-005 Analysis | TBD | PAGE-010 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-013 | MOD-005 Analysis | TBD | PAGE-010 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-014 | MOD-005 Analysis | TBD | PAGE-010 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-015 | MOD-005 research; formula H | TBD | TBD | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-016 | MOD-005 Analysis | TBD | PAGE-010 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-017 | MOD-005 Analysis | FTR-NEW-017 | PAGE-011 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-018 | MOD-005 Analysis | TBD | TBD | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-019 | MOD-005 Analysis | TBD | PAGE-010 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-NEW-020 | MOD-005 Analysis | TBD | PAGE-010 | TBD | TBD | TST-CONTRACT | DEC-014; DEC-016; DEC-022; formulas H where noted | NOT_STARTED |
| FR-RM-001 | MOD-011 Realms | TBD | PAGE-044; PAGE-045 | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-RM-002 | MOD-011 Realms | TBD | TBD | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-RM-003 | MOD-011 Realms | TBD | TBD | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-RM-004 | MOD-011 Realms | TBD | TBD | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-RM-005 | MOD-011 Realms | TBD | TBD | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-RM-006 | MOD-011 Realms | TBD | TBD | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-RM-007 | MOD-011 Realms | TBD | TBD | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-RM-008 | MOD-011 Realms | TBD | TBD | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-RM-009 | MOD-011 Realms | TBD | TBD | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-RM-010 | MOD-011 Realms | TBD | PAGE-044 | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-RM-011 | MOD-011 Realms | TBD | TBD | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-RM-012 | MOD-011 Realms | TBD | TBD | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-SC-001 | MOD-009 Social | TBD | PAGE-029; PAGE-030 | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-SC-002 | MOD-009 Social | TBD | PAGE-030 | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-SC-003 | MOD-009 Social | TBD | PAGE-030 | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-SC-004 | MOD-009 Social | TBD | PAGE-031 | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-SC-005 | MOD-009 Social | TBD | PAGE-030; PAGE-031 | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-SC-006 | MOD-009 Social | TBD | TBD | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-SC-007 | MOD-009 Social | TBD | TBD | TBD | TBD | TBD | DEC-023 | NOT_STARTED |
| FR-TR-001 | MOD-015 Trust | TBD | PAGE-058 | TBD | TBD | TST-SECURITY | DEC-007; DEC-054 | NOT_STARTED |
| FR-TR-002 | MOD-015 Trust | TBD | PAGE-057 | TBD | TBD | TST-SECURITY | DEC-007; DEC-054 | NOT_STARTED |
| FR-TR-003 | MOD-015 Trust | TBD | TBD | TBD | TBD | TST-SECURITY | DEC-007; DEC-054 | NOT_STARTED |
| FR-TR-004 | MOD-015 Trust | TBD | TBD | TBD | TBD | TST-SECURITY | DEC-007; DEC-054 | NOT_STARTED |
| FR-P0-001 | v5 architecture contract | UC-GM-10 | TBD | GameResult | game.finished.v1; outbox | TST-CONTRACT | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-002 | v5 architecture contract | UC-ID-01 | TBD | GuestIdentity | TBD release | TST-SECURITY | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-003 | v5 architecture contract | UC-ID-02 | TBD | GuestIdentity | claim shape; method H | TST-SECURITY | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-004 | v5 architecture contract | UC-GM-09 | TBD | ReconnectToken | reconnect state machine | TST-RECONNECT | DEC-038–DEC-054 as applicable | PARTIAL (P1-B9): see FR-GM-004. TransportInterrupted → ResyncRequired → Resyncing → ActiveControlled is carried by reconnect + `sync_game`; the server clock keeps running through a disconnect. ViewOnly, LeaseSuperseded, and AbandonmentEvaluation are not built |
| FR-P0-005 | v5 architecture contract | UC-GM-09 | TBD | ClockState | reconnect state machine | TST-CLOCK | DEC-038–DEC-054 as applicable | NOT_STARTED. *Later status (P1-B9):* the clock keeps running and the writer flags at the deadline with no socket open (TST-RT-006, 023, TST-EDGE-026); after a restart the game is recovery-paused and `recovery_required` is sent (TST-RT-DB-003). Status unchanged. *Later status (P1-B9.1):* a game activated through the registry is flagged with no client at all, and the flag is persisted by the rules: UNKNOWN is unresolved, proven capability is a result (TST-RT-ACT-001, 002, TST-RT-DB-004). A persistence outage or writer fault pauses the clock instead of consuming it (`recovery_required` `PERSISTENCE_UNAVAILABLE` / `WRITER_FAULT`). Status unchanged. *Later status (P1-B9.2):* after a concurrency conflict or an unconfirmed create no competitive timer runs and no time is charged; the clock shows the stored balances with `running: false` (TST-RT-OWN-001, 003, TST-RT-CREATE-001, 003). Status unchanged |
| FR-P0-006 | v5 architecture contract | TBD | TBD | Session | control lease | TST-SECURITY | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-007 | v5 architecture contract | TBD | TBD | Session | control lease | TST-SECURITY | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-008 | v5 architecture contract | UC-GM-05 | TBD | GameResult | local import shape; product not opened | TST-STATE | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-009 | v5 architecture contract | TBD | TBD | Game | process boundaries | TST-FAILURE | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-010 | v5 architecture contract | UC-TS-05 | TBD | TBD | failure annex | TST-FAILURE | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-011 | v5 architecture contract | UC-AI-04 | TBD | Game | DEC-047 | TST-SECURITY | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-012 | v5 architecture contract | UC-AI-04 | TBD | TBD | packaging rule | TST-SECURITY | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-013 | v5 architecture contract | TBD | TBD | all owned entities | DEC-048 | TST-SECURITY | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-014 | v5 architecture contract | UC-GM-02 | TBD | Move | SubmitMoveCommand.v1 | TST-COMMAND | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-015 | v5 architecture contract | UC-TS-05 | TBD | FeatureFlag | feature.disabled.v1 | TST-FAILURE | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-016 | v5 architecture contract | TBD | TBD | AuditEvent | DEC-054 | TST-SECURITY | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-017 | v5 architecture contract | TBD | TBD | Game | ruleset_id `FIDE-E01-2023` | TST-RULE; TST-FOUND-RULESET | DEC-051 A | PARTIAL: registry in `domain/chess-rules` (P1-B1). No Game entity stores it yet |
| FR-P0-018 | v5 architecture contract | TBD | TBD | TBD | DEC-049 | TBD | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-019 | v5 architecture contract | TBD | TBD | TBD | DEC-050 | TBD | DEC-038–DEC-054 as applicable; DEC-050 | NOT_STARTED |
| FR-P0-020 | v5 architecture contract | TBD | TBD | Account | DEC-038 | TBD | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P06-001 | Engineering constitution | TBD | TBD | TBD | DEC-055 | TST-SECURITY | DEC-055 | NOT_STARTED |
| FR-P06-002 | Stack baseline | TBD | TBD | TBD | DEC-056 | TST-FAILURE | DEC-056; DEC-057 | PARTIAL: TypeScript, Node 24, pnpm, Biome, Vitest, fast-check in use (P1-B1). Next, React, Fastify, PostgreSQL, Kysely not started. ENV-NODE-001 resolved: local Node 24.21.0 LTS and pnpm 12.7.0 (toolchain maintenance 2026-09-28; opened in P1-B1.1) |
| FR-P06-003 | Version currency | TBD | TBD | TBD | STACK_DECISION_RECORD_V1 | TBD | DEC-057 | PARTIAL: exact pins and lockfile for Batch 1 tools (P1-B1) |
| FR-P06-004 | Repository boundaries | TBD | TBD | TBD | DEC-058 | TST-BOUNDARY | DEC-058 | PARTIAL: pnpm workspace and `check:boundaries` for domain packages (P1-B1). Checker parses with the pinned TypeScript AST and rejects ambient globals, eval, and the Function constructor in domain code (P1-B1.1). `server/live-game` has its own policy: only the public game-values and chess-rules entries, the same ambient and evaluation bans, no deep or relative reach into its internals, and Biome and typecheck coverage (P1-B5) |
| FR-P06-005 | FIDE article classes | TBD | TBD | Game | CHESS_RULES_AUTHORITY_PACK_V1 | TST-RULE | DEC-051 | PARTIAL: Articles 3.1–3.10.2 movement and legality in `domain/chess-rules` (attacks, legal moves, transition, perft) (P1-B2). Checkmate/stalemate as pure rule facts (Articles 5.1.1, 5.2.1: `evaluateMoveExhaustion`) and output-only Chess One canonical SAN (derived from FIDE Appendix C: `toCanonicalSan`) (P1-B3). Article 9.2.3 repetition identity with legal en passant availability (`repetitionKey`), pure threefold/fifty-move claim assessment (9.2, 9.3, 9.5.2–9.5.3: `evaluateDrawClaim`), and automatic fivefold/seventy-five-move facts (9.6.1, 9.6.2: `evaluateAutomaticDraws`) over a supplied history (P1-B4). Durable GameResult, game events, clock application of the 9.5.3 bonus, draw agreement, dead-position completion, and 3.10.3 reachability not started. *Later status:* the live-game authority applies the 9.5.3 bonus and completes dead positions (P1-B5), and decides draw agreement (5.2.3, P1-B7; see FR-P06-007) |
| FR-P06-006 | Dead position partial | TBD | TBD | GameResult | mating research | TST-RULE | DEC-062; DEC-064 | PARTIAL: whole-position detector for the hand-proven set only (P1-B1). Not wired to any result. Accepts only a canonical `Position` (P1-B1.1) |
| FR-P06-007 | Draw and resign contracts | TBD | TBD | Game | ClaimDrawCommand.v1; OfferDrawCommand.v1; RespondDrawOfferCommand.v1; ResignGameCommand.v1 | TST-COMMAND | DEC-051 | PARTIAL: `ClaimDrawCommand.v1` (P1-B5), `ResignGameCommand.v1` (P1-B6), and `OfferDrawCommand.v1` and `RespondDrawOfferCommand.v1` (P1-B7) in the in-memory live-game authority. All four contract commands are decided; transport, persistence, and client surfaces are not built. Resignation outcomes follow LIVE-CONTRACT-001; LIVE-CONTRACT-006 and LIVE-RESIGN-001 are resolved (P1-B6.1). Golden rows 017a to 017c are implemented (P1-B7) |
| FR-P06-008 | Event ordering | TBD | TBD | ClockState | LIVE_GAME_EVENT_ORDERING_V1 | TST-CLOCK | DEC-061; DEC-063 | NOT_STARTED |
| FR-P06-009 | Online policy | TBD | TBD | Game | CHESS_ONE_ONLINE_PLAY_POLICY_V1 | TST-RECONNECT | DEC-060 | NOT_STARTED |
| FR-P06-010 | Security gates | TBD | TBD | Session | SECURITY_THREAT_MODEL_V1 | TST-SECURITY | DEC-055 | NOT_STARTED |
| FR-P06-011 | Chess-library license gate | TBD | TBD | TBD | ENGINEERING_CONSTITUTION_V1 | TST-BOUNDARY | DEC-055 | PARTIAL: boundary check rejects chess.js, chessops, Stockfish packages (P1-B1). License decision itself still open |
| FR-P1-001 | Receipt clock domain | TBD | TBD | ClockState | LIVE_GAME_EVENT_ORDERING_V1 section 2.1 | TST-CLOCK | DEC-063 | NOT_STARTED |
| FR-P1-002 | Unresolved mating possibility | TBD | TBD | GameResult | MATING_POSSIBILITY_UNRESOLVED; no game.finished.v1 | TST-RULE | DEC-064 | NOT_STARTED |

Row count: 145 preserved functional requirements + 20 FR-P0 requirements + 11 FR-P06 requirements + 2 FR-P1 requirements.

Open blockers remain: CON-005, Q-04, Q-05, DEC-052, MIS-008, guest proof, abandonment threshold, full mating-possibility algorithm, Chess One distribution license, lag compensation, premove. DEC-051 is A for `FIDE-E01-2023`. DEC-056 approves starting stack families. Patch numbers are not architectural constants.
