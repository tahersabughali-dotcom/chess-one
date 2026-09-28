# Chess Rules Golden Test Ledger v1 / دفتر الاختبارات الذهبية

**Ruleset / القوانين:** `FIDE-E01-2023` only.  
**Status / الحالة:** Planned fixtures. Phase 1 Batch 1 implements only the rows listed as implemented in `PHASE_1_IMPLEMENTATION_LOG.md`. Every other row is NOT_IMPLEMENTED. A row here is not a passing test.  
**Authority / السلطة:** the FIDE source and `CHESS_RULES_AUTHORITY_PACK_V1.md`. An external engine is not an oracle of law.

المطلوب تغطية الفروع، لا تكثير صفوف متشابهة. كل فرع حرج له صف، أو فجوة مذكورة في قسم الفجوات.

الأعمدة المختصرة في الجداول: المعرّف، المادة، الحالة، الفعل، النتيجة. SAN المرجعي يولّده الخادم عند القبول. التاريخ حين يُذكر هو تاريخ خادمي، لا FEN يرسله العميل كسلطة.

## 1. Normal legal / نقلات قانونية

| Test | Article | State | Action | Expected |
|---|---|---|---|---|
| TST-RULE-E01-001 | 2, 3 | `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1` | e2e4 | Accepted. Server SAN `e4`. Not terminal. Sequence +1 |

## 2. Illegal / غير قانوني

| Test | Article | State | Action | Expected |
|---|---|---|---|---|
| TST-RULE-E01-002 | 3.7 | Initial | e2e5 | IllegalMove. No state change |
| TST-RULE-E01-003 | 3.1 | Initial | e1d2 | IllegalMove. Own-piece destination |
| TST-RULE-E01-006 | 3.8, 3.9 | `8/8/4k3/8/4K3/8/8/8 w - - 0 1` | e4e5 | IllegalMove. Kings would be adjacent |

## 3. Check, pin, double check / الكش والتسمير

| Test | Article | State | Action | Expected |
|---|---|---|---|---|
| TST-RULE-E01-004 | 3.9.2 | `4k3/4n3/8/8/8/8/8/4R1K1 b - - 0 1` | e7c6 | IllegalMove. The knight is pinned to the king on e8 by the rook on e1. The knight still counts as attacking while it stays |
| TST-RULE-E01-005 | 3.9 | `4k3/8/8/8/4B3/8/8/4R1K1 w - - 0 1` | e4c6 | Accepted. Bishop and rook both give check. This proves double check as two attacks, not a separate piece rule |

## 4. Castling / التبييت

| Test | Article | State | Action | Expected |
|---|---|---|---|---|
| TST-RULE-E01-007 | 3.8.2 | `r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1` | e1g1 | IllegalMove. Pieces look ready and the rights field is empty |
| TST-RULE-E01-008a | 3.8.2.2 | `1k3r2/8/8/8/8/8/8/R3K2R w KQ - 0 1` | e1g1 | IllegalMove. f1 is attacked by the rook on f8. e1 is not attacked, so the reason is the crossed square, not check |
| TST-RULE-E01-008b | 3.8.2.2 | Same as 008a | e1c1 | Accepted. Server SAN `O-O-O`. e1, d1, and c1 are not attacked, b1 is empty, and the black king on b8 does not reach rank 1 |

The earlier 008a FEN `5r2/8/8/8/8/8/8/R3K2R w KQ - 0 1` had no black king and was structurally invalid. It is replaced. The Batch 1 fixture test validates the FEN structure of every row in this ledger.

## 5. En passant / الأخذ بالتجاوز

| Test | Article | State | Action | Expected |
|---|---|---|---|---|
| TST-RULE-E01-009 | 3.7.3.1 | `4k3/8/8/3pP3/8/8/8/6K1 w - d6 0 1` | e5d6 | Accepted. Captured pawn square is derived as d5. Server SAN includes the en passant capture |
| TST-RULE-E01-010 | 3.9.2 | `8/8/8/r2pP2K/8/8/8/4k3 w - d6 0 1` | e5d6 | IllegalMove. The capture opens the fifth rank from the rook on a5 onto the king on h5 |

## 6. Promotion / الترقية

| Test | Article | State | Action | Expected |
|---|---|---|---|---|
| TST-RULE-E01-011a | 3.7.3.3 | `8/P7/8/8/8/8/8/k1K5 w - - 0 1` | a7a8 with no promotion | InvalidState. No auto-queen |
| TST-RULE-E01-011b | 3.7.3.3 | Same | a7a8 promotion q | Accepted. Server SAN `a8=Q#`: the resulting position is checkmate |
| TST-RULE-E01-011c | 3.7.3.3 | Same | a7a8 promotion n | Accepted. Server SAN `a8=N`. Underpromotion is legal |
| TST-RULE-E01-011d | 3.7.3.3 | Initial | e2e4 promotion q | InvalidState. Promotion on a non-promotion move |

## 7. Checkmate, stalemate, dead / النهاية

| Test | Article | State | Action | Expected |
|---|---|---|---|---|
| TST-RULE-E01-012 | 5.1.1 | `k7/1QK5/8/8/8/8/8/8 b - - 0 1` | Black to move, no command required | Terminal. `white_win`, `checkmate`. The king on a8 is in check from the queen on b7 and has no legal move |
| TST-RULE-E01-013 | 5.2.1 | `k7/2K5/1Q6/8/8/8/8/8 b - - 0 1` | Black to move | Terminal draw, `stalemate`. The king on a8 is not in check |
| TST-RULE-E01-014a | 5.2.2 | `8/8/8/8/4k3/8/8/4K3 w - - 0 1` | Detector | `PROVEN_DEAD` is allowed after the hand proof. Draw `dead_position` |
| TST-RULE-E01-014b | 5.2.2 | `8/8/8/8/4k3/8/4B3/4K3 w - - 0 1` | Detector | Same, king and one bishop versus lone king |
| TST-RULE-E01-014c | 5.2.2 | `8/8/8/8/4k3/8/4N3/4K3 w - - 0 1` | Detector | Same, king and one knight versus lone king |
| TST-RULE-E01-014d | 5.2.2 | `8/8/8/8/4k3/8/2N1N3/4K3 w - - 0 1` | Detector | Must not return `PROVEN_DEAD`. Two knights versus a lone king can reach mate with cooperation |

The earlier 014d FEN `8/8/8/8/4k3/8/3NN3/4K3 w - - 0 1` had the knight on d2 attacking the black king on e4 with White to move. That is an illegal position. The knights now stand on c2 and e2, and neither attacks e4.

## 8. Resignation and timeout / الاستقالة والوقت

| Test | Article | State | Action | Expected |
|---|---|---|---|---|
| TST-RULE-E01-015a | 5.1.2, 5.2.2 | Position 014a | ResignGame by the side to move | InvalidState. The game already ended as `dead_position` under 5.2.2. A reachable `resign_no_mate_possible` case needs the one-sided check in GAP-MATE-004 |
| TST-RULE-E01-015b | 5.1.2 | Position 012, the winner resigns in a rebuilt non-terminal predecessor where the opponent has a queen, and a reviewed `NOT_DEAD` proof exists for that position | Resign | Loss for the resigner. `NOT_DEAD` must not become a draw |
| TST-RULE-E01-015c | 5.1.2 | A position where the detector returns `UNKNOWN` | Resign | `MATING_POSSIBILITY_UNRESOLVED`. No official win, loss, or draw. No `game.finished.v1`, rating, reward, standing, or career result (DEC-064) |
| TST-RULE-E01-016a | 6.9 | A position where the detector returns `NOT_DEAD` | Command received after the monotonic deadline | Move not applied. Loss on time |
| TST-RULE-E01-016e | 6.9 | A position where the detector returns `UNKNOWN` | Receipt after deadline | Move not applied. `MATING_POSSIBILITY_UNRESOLVED`. No official result and no `game.finished.v1` (DEC-064) |
| TST-RULE-E01-016b | 6.9, 5.2.2 | Position 014a | Receipt after deadline | No flag result. The game already ended as `dead_position`, and the clock stopped there. A reachable `timeout_no_mate` case needs the one-sided check in GAP-MATE-004 |
| TST-RULE-E01-016c | 5.1.1, 6.9 | A mating move | Receipt before deadline, apply finishes after the wall deadline | Checkmate. The processing interval is not deducted |
| TST-RULE-E01-016d | 6.9 | Mating squares that arrive after the deadline | Receipt after deadline | Not checkmate. Flag result stands |

## 9. Draws and claims / التعادل والمطالبات

| Test | Article | State | Action | Expected |
|---|---|---|---|---|
| TST-RULE-E01-017a | 5.2.3 | Initial, no moves yet | OfferDraw | InvalidState |
| TST-RULE-E01-017b | 5.2.3 | After each side has made one move, opponent to move | Offer then accept | `draw_agreed` |
| TST-RULE-E01-017c | 9.1 | Pending offer | Recipient's legal move | Offer declined. The move is judged on its own |
| TST-RULE-E01-018 | 9.2 | Server history: Nf3 Nf6, Ng1 Ng8, Nf3 Nf6, Ng1 Ng8, and the start position is now present for the third time with White to move | ClaimDraw `threefold_current` | Draw `threefold_claim`. The third appearance alone, without the claim, does not finish the game |
| TST-RULE-E01-019 | 9.6.1 | The same maneuver continued until that position appears the fifth time | No claim | Automatic draw `fivefold` |
| TST-RULE-E01-020 | 9.3 | Server history of 50 moves by each side with no pawn move and no capture, position not `PROVEN_DEAD` | ClaimDraw `fifty_move_current` by the side to move | Draw `fifty_move_claim`. Without the claim the game continues |
| TST-RULE-E01-018b | 9.2.1 | Server history from the initial position: Nf3 Nf6, Ng1 Ng8, Nf3 Nf6, Ng1. The initial position has occurred twice. Black to move | ClaimDraw `threefold_intended` with intended f6g8 | Draw `threefold_claim`. The intended move would create the third occurrence, which has not happened yet |
| TST-RULE-E01-020b | 9.3.1 | Server history H50 below: 99 knight moves from the initial position, no pawn move, no capture, no repeated position. Black to move | ClaimDraw `fifty_move_intended` with intended g8f6 | Draw `fifty_move_claim`. The intended move completes 50 moves by each player. The halfmove counter is derived from server history, not from a client FEN |
| TST-RULE-E01-020c | 9.3.1, 9.5.3 | H50 | ClaimDraw `fifty_move_intended` with intended a7a6 | Incorrect claim. A pawn move resets the count. No draw. Opponent remaining time +120000 ms. Then a7a6 is applied |
| TST-RULE-E01-021a | 9.6.2 | Server history at the automatic 75 threshold, move is not mate | No claim | Draw `seventy_five_move` |
| TST-RULE-E01-021b | 9.6.2, 5.1.1 | `k7/2K5/8/8/8/8/1Q6/8 w - - 149 80` | b2b7, which completes the 75-move count and mates | `white_win`, `checkmate`. Mate outranks the automatic draw |
| TST-RULE-E01-022a | 9.5.3 | Initial | ClaimDraw threefold | No draw. Opponent remaining time +120000 ms |
| TST-RULE-E01-022b | 9.5.3 | Initial | False threefold claim with intended e2e4 | No draw. +120000 ms. Then e2e4 is applied |
| TST-RULE-E01-022c | 9.5.3 | Initial | False claim with intended e2e5 | No draw. +120000 ms. e2e5 is not applied |
| TST-RULE-E01-023a | 9.2.3 | Two server histories with the same piece squares, castling rights KQkq versus KQk | Claim | Not the same position. Incorrect claim path |
| TST-RULE-E01-023b | 9.2.3 | Same piece squares, one history has en passant availability and the other has none | Claim | Not the same position |

**History H50 (UCI, from the initial position):**

```text
b1c3 b8c6 c3d5 c6b8 d5e3 b8c6 e3f5 c6b8 f5g3 b8c6 g1h3 c6b8 g3h5 b8c6 h3g5 c6b8 g5f3 b8c6
f3h4 c6b8 h4f5 b8c6 f5g3 c6b8 g3e4 b8c6 e4c5 c6b8 c5d3 b8c6 d3e5 c6b8 e5g4 b8c6 g4e3 c6b8
e3d5 b8c6 d5f4 c6b8 h5g3 b8c6 f4d5 c6b8 d5e3 b8c6 e3f5 c6b8 f5h4 b8c6 g3f5 c6b8 f5e3 b8c6
e3g4 c6b8 g4e5 b8c6 e5f3 c6b8 f3g5 b8c6 g5h3 c6b8 h3f4 b8c6 f4d5 c6b8 d5c3 b8c6 c3e4 c6b8
e4c5 b8c6 c5d3 c6b8 d3b4 b8c6 h4f5 c6b8 b4d5 b8c6 d5e3 c6b8 e3g4 b8c6 f5g3 c6b8 g3e4 b8c6
e4g5 c6b8 g4e5 b8c6 e5f3 c6b8 f3d4 b8c6 d4f5
```

Construction: White knights stay on b1, g1, or ranks 3–5. Black knights stay on b8, g8, or ranks 4–6. Every destination is empty. A white knight on rank 5 or lower cannot attack e8, and a black knight on rank 4 or higher cannot attack e1. No pawn moves, so no line opens to either king. Every move is legal, no move gives check, no move captures, and all 100 positions from the start through ply 99 are distinct. After ply 99: white knights f5 and g5, black knights c6 and g8, Black to move, castling KQkq, no en passant target. The Batch 1 fixture test replays H50 with a knight-only integrity check. It is not the move engine.

## 10. Serialization and command identity / التسلسل وهوية الأمر

| Test | Contract | Expected |
|---|---|---|
| TST-RULE-E01-024 | Same `client_command_id` and same squares after Accepted | `replayed_response = true`, still Accepted, one move only |
| TST-RULE-E01-025 | Same id, different squares | `InvalidCommandIdentity`, no execution |
| TST-RULE-E01-026 | Client SAN disagrees with the squares | Server SAN from the squares is stored |
| TST-RULE-E01-027 | `actor_id` names the other seat | Unauthorized. Seat unchanged |
| TST-RULE-E01-028 | Client clock stamp far in the past | Receipt time is unchanged |

## 11. Plans that are not extra vanity rows / خطط بلا صفوف شكلية

| Plan | Role | Limit |
|---|---|---|
| Perft | Move-generation regression from the initial position. Planned depths: 1 → 20, 2 → 400, 3 → 8902, 4 → 197281. Depth 5 (4865609) is a later performance fixture | Perft does not prove dead positions, claims, or mate precedence |
| Property-based | fast-check generates square commands. Invariants: no accepted move leaves the mover's king in check; sequence grows by one only on Accepted; one command id never yields two moves | Seeds and shrinkers are an implementation detail |
| Mutation | Flip one expected legality bit in a golden row and require the suite to fail | Proves the assertion is alive |
| Fuzz | Random legal-looking commands against a running rules function, bounded | Crashes and invariant breaks are defects. A fuzz hit is not a new FIDE article |
| Differential | Compare with an independent implementation only after the license gate in the constitution | Disagreement is investigated. The other program does not win by default |

## 12. Gaps that must stay visible / فجوات تبقى ظاهرة

- لا صف يدّعي كاشفًا كاملًا للموضع الميت. المجموعة الجزئية فقط في 014a–014c، والمانع في 014d.
- GAP-MATE-001 وGAP-MATE-002 وGAP-MATE-003 بلا اختبار نجاح مزعوم.
- `UNKNOWN` لا يظهر في أي صف كنتيجة رسمية. الصفان 015c و016e يثبتان الحالة غير المحسومة (DEC-064).
- أوضاع البيدق المقفلة بلا صف `PROVEN_DEAD`.
- تعويض التأخير والنقلة المسبقة ومهلة الهجر بلا صف رقمي.
