# Traceability Matrix v2 / مصفوفة التتبع — الإصدار 2

**Supersedes for implementation / يحل محل التنفيذ:** section 48 in the preserved v4 text. That section mapped architecture requirements to MOD-014 and social requirements to the tournament module. Do not use it.

**Implementation status / حالة التنفيذ:** `NOT_STARTED` unless a row says `PARTIAL`. Phase 1 Batch 1 (P1-B1) advanced six rows partially; Batch 1.1 (P1-B1.1) hardened three of them without changing their status; Batch 2 (P1-B2) advanced FR-P06-005 to PARTIAL; Batch 3 (P1-B3) extended FR-P06-005 without changing its status; see `PHASE_1_IMPLEMENTATION_LOG.md`. No row is complete.

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
| FR-ARC-003 | Architecture cross-cutting | UC-GM-10 | TBD | GameResult | game.finished.v1; outbox | TST-CONTRACT | DEC-004; DEC-033; DEC-048; DEC-040 | NOT_STARTED |
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
| FR-GM-001 | MOD-002 Live Game Authority | TBD | PAGE-005; PAGE-006 | TBD | TBD | TST-STATE | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | NOT_STARTED |
| FR-GM-002 | MOD-002 Live Game Authority | TBD | PAGE-006 | ClockState | TBD | TST-CLOCK | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | NOT_STARTED |
| FR-GM-003 | MOD-002 Live Game Authority | TBD | PAGE-006 | Move; Game | SubmitMoveCommand.v1 | TST-RULE; TST-COMMAND | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | NOT_STARTED |
| FR-GM-004 | MOD-002 Live Game Authority | UC-GM-09 | PAGE-006 | ReconnectToken; Game | reconnect state machine | TST-RECONNECT | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045; DEC-042; DEC-043 | NOT_STARTED |
| FR-GM-005 | MOD-002 Live Game Authority | UC-TS-05 | PAGE-006 | TBD | TBD | TST-FAILURE | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | NOT_STARTED |
| FR-GM-006 | MOD-002 Live Game Authority | TBD | PAGE-006 | TBD | TBD | TST-STATE | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | NOT_STARTED |
| FR-GM-007 | MOD-002 Live Game Authority | TBD | PAGE-006 | TBD | TBD | TST-STATE | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | NOT_STARTED |
| FR-GM-008 | MOD-002 Live Game Authority | UC-GM-08 | PAGE-007 | TBD | TBD | TST-STATE | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | NOT_STARTED |
| FR-GM-009 | MOD-002 Live Game Authority | UC-GM-10 | PAGE-006 | GameResult | game.finished.v1 | TST-CONTRACT | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | NOT_STARTED |
| FR-GM-010 | MOD-002 Live Game Authority | TBD | PAGE-006 | GameResult | SubmitMoveCommand.v1 | TST-SECURITY; TST-COMMAND | DEC-005; DEC-006; DEC-040; DEC-042; DEC-045 | NOT_STARTED |
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
| FR-P0-004 | v5 architecture contract | UC-GM-09 | TBD | ReconnectToken | reconnect state machine | TST-RECONNECT | DEC-038–DEC-054 as applicable | NOT_STARTED |
| FR-P0-005 | v5 architecture contract | UC-GM-09 | TBD | ClockState | reconnect state machine | TST-CLOCK | DEC-038–DEC-054 as applicable | NOT_STARTED |
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
| FR-P06-002 | Stack baseline | TBD | TBD | TBD | DEC-056 | TST-FAILURE | DEC-056; DEC-057 | PARTIAL: TypeScript, Node 24, pnpm, Biome, Vitest, fast-check in use (P1-B1). Next, React, Fastify, PostgreSQL, Kysely not started. ENV-NODE-001 open: local Node 24.14.1 is below the reviewed 24.21.0 LTS baseline (P1-B1.1) |
| FR-P06-003 | Version currency | TBD | TBD | TBD | STACK_DECISION_RECORD_V1 | TBD | DEC-057 | PARTIAL: exact pins and lockfile for Batch 1 tools (P1-B1) |
| FR-P06-004 | Repository boundaries | TBD | TBD | TBD | DEC-058 | TST-BOUNDARY | DEC-058 | PARTIAL: pnpm workspace and `check:boundaries` for domain packages (P1-B1). Checker parses with the pinned TypeScript AST and rejects ambient globals, eval, and the Function constructor in domain code (P1-B1.1) |
| FR-P06-005 | FIDE article classes | TBD | TBD | Game | CHESS_RULES_AUTHORITY_PACK_V1 | TST-RULE | DEC-051 | PARTIAL: Articles 3.1–3.10.2 movement and legality in `domain/chess-rules` (attacks, legal moves, transition, perft) (P1-B2). Checkmate/stalemate as pure rule facts (Articles 5.1.1, 5.2.1: `evaluateMoveExhaustion`) and output-only Chess One canonical SAN (derived from FIDE Appendix C: `toCanonicalSan`) (P1-B3). Durable GameResult, game events, draws, repetition, 50/75-move rules, dead-position completion, and 3.10.3 reachability not started |
| FR-P06-006 | Dead position partial | TBD | TBD | GameResult | mating research | TST-RULE | DEC-062; DEC-064 | PARTIAL: whole-position detector for the hand-proven set only (P1-B1). Not wired to any result. Accepts only a canonical `Position` (P1-B1.1) |
| FR-P06-007 | Draw and resign contracts | TBD | TBD | Game | ClaimDrawCommand.v1; OfferDrawCommand.v1; RespondDrawOfferCommand.v1; ResignGameCommand.v1 | TST-COMMAND | DEC-051 | NOT_STARTED |
| FR-P06-008 | Event ordering | TBD | TBD | ClockState | LIVE_GAME_EVENT_ORDERING_V1 | TST-CLOCK | DEC-061; DEC-063 | NOT_STARTED |
| FR-P06-009 | Online policy | TBD | TBD | Game | CHESS_ONE_ONLINE_PLAY_POLICY_V1 | TST-RECONNECT | DEC-060 | NOT_STARTED |
| FR-P06-010 | Security gates | TBD | TBD | Session | SECURITY_THREAT_MODEL_V1 | TST-SECURITY | DEC-055 | NOT_STARTED |
| FR-P06-011 | Chess-library license gate | TBD | TBD | TBD | ENGINEERING_CONSTITUTION_V1 | TST-BOUNDARY | DEC-055 | PARTIAL: boundary check rejects chess.js, chessops, Stockfish packages (P1-B1). License decision itself still open |
| FR-P1-001 | Receipt clock domain | TBD | TBD | ClockState | LIVE_GAME_EVENT_ORDERING_V1 section 2.1 | TST-CLOCK | DEC-063 | NOT_STARTED |
| FR-P1-002 | Unresolved mating possibility | TBD | TBD | GameResult | MATING_POSSIBILITY_UNRESOLVED; no game.finished.v1 | TST-RULE | DEC-064 | NOT_STARTED |

Row count: 145 preserved functional requirements + 20 FR-P0 requirements + 11 FR-P06 requirements + 2 FR-P1 requirements.

Open blockers remain: CON-005, Q-04, Q-05, DEC-052, MIS-008, guest proof, abandonment threshold, full mating-possibility algorithm, Chess One distribution license, lag compensation, premove. DEC-051 is A for `FIDE-E01-2023`. DEC-056 approves starting stack families. Patch numbers are not architectural constants.
