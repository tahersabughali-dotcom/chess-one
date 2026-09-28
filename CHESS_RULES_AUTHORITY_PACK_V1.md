# Chess Rules Authority Pack v1 / حزمة سلطة قوانين الشطرنج

**Ruleset / المعرّف:** `FIDE-E01-2023`.  
**Source / المصدر:** FIDE Laws of Chess effective 1 January 2023, English authentic text, FIDE Handbook `https://handbook.fide.com/chapter/e012023`. Approved 2022-08-07, applied 2023-01-01.  
**Method / المنهج:** صُنفت المواد من نص المصدر. النص الطويل غير منسوخ. لا مكتبة شطرنج استُخدمت كمرجع قانوني.

التصنيف:

| Class | Meaning |
|---|---|
| A | Chess Rules Library behavior |
| B | Live Game / clock behavior |
| C | Chess One online policy, not a FIDE rule |
| D | Tournament or arbiter behavior |
| E | Over-the-board only, not a digital move engine |
| F | Future or variant, outside this ruleset id |

## 1. Article classification / تصنيف المواد

| Article | Class | Engineering disposition |
|---|---|---|
| 1, including the checkmate objective | A | The library recognizes checkmate as the competitive objective of a legal game |
| 1.5 | A | Pointer to dead position. Behavior is 5.2.2 plus the mating-possibility research. Partial |
| 2 | A | Standard initial placement. A game created under this ruleset starts there unless a later reviewed setup command exists. No such command is opened here |
| 3.1–3.1.3 | A | Occupation, capture, and attack. Attack exists even when the attacker is pinned |
| 3.2–3.6 | A | Bishop, rook, queen, knight, and blocking |
| 3.7.1–3.7.3.2 | A | Pawn step, double step, capture, en passant on the next move only |
| 3.7.3.3–3.7.3.5 | A | Explicit promotion to Q, R, B, or N, including a piece still on the board. Effect is immediate. Digital path does not auto-queen |
| 3.8–3.8.2.2 | A | King step and castling, including lost rights and squares attacked |
| 3.9 | A | Check, and the ban on moving into or remaining in check. Covers pins, discovered check, and double check as consequences |
| 3.10.1–3.10.2 | A | Legal move definition used by `SubmitMoveCommand.v1` |
| 3.10.3 | A for detection, D for repair | An illegal position is not a legal game state. Repair is an arbiter act, not a silent library rewrite. Import of an illegal diagram fails closed |
| 4.1–4.9 touch, one hand, clock press by hand | E | A digital command already names squares. Touch-move is not server state |
| 5.1.1 | A | Checkmate ends the game immediately |
| 5.1.2 | A + partial B | Resignation. Draw only on `PROVEN_DEAD`. See mating research |
| 5.2.1 | A | Stalemate |
| 5.2.2 | A, partial | Dead position. Only `PROVEN_DEAD` |
| 5.2.3 | A + B | Draw by agreement after both sides have made at least one move. Commands in the catalog |
| 6.1–6.2.2 | B | One clock runs. Digital completion is server commit of an in-time command, not a physical press. Time until receipt counts. Time after receipt does not |
| 6.2.3–6.2.6 | E / D | Hands, hovering, assistants |
| 6.3 | B | Allotted time and increment or delay are time-control parameters of the live game, not a new ruleset. Which modes ship in a first product slice stays H |
| 6.4, 6.8, 6.9 | B | Flag is a server fact at the writer's monotonic receipt time (DEC-061, DEC-063), not an arbiter observation. 6.9 draw branch is partial |
| 6.5–6.7 | D | Clock placement and default arrival time. Not imported as an online number |
| 6.10 | D | Defective physical clock. Server clock defects are an incident, not a player-adjustable time |
| 6.11 | D / C | Arbiter pause is not a player network pause. Disconnect handling is online policy |
| 6.12 | D | Demonstration boards. A digital claim cannot rest on a spectator widget |
| 7.1, 7.2 | D | Restoring an irregular game is arbiter work |
| 7.3–7.4 | D | Displacement and illegal positions discovered over the board |
| 7.5 | E for the digital command path | The server rejects an illegal move before commit, so the completed-illegal penalty ladder does not run. Article 7.5.2's physical queen replacement is not the digital promotion rule |
| 7.6–7.8 | D | Remaining irregularity procedure |
| 8 | E for the player's scoresheet; B for the canonical record | The server record is the authoritative move list. Player notation duty is not a digital loss condition |
| 9.1.1–9.1.2 | A + B | Offer and acceptance. Catalog commands. A recipient's move declines |
| 9.2–9.2.3 | A | Threefold is a claim. Identity includes side to move, castling rights, and en passant availability |
| 9.3 | A | Fifty-move claim, not an automatic draw at 50 |
| 9.4 | E | Touch-move forfeiture of a claim has no digital equivalent |
| 9.5.1 | B mapped, not a player pause | The server evaluates inline. Disconnect does not pause the clock |
| 9.5.2–9.5.3 | A + B | Correct claim draws. Incorrect claim adds 120000 ms to the opponent and then plays a legal indicated move |
| 9.6.1 | A | Fivefold automatic draw |
| 9.6.2 | A | Seventy-five automatic draw. Checkmate on that move wins |
| 10 | D | Tournament points. Not `GameResult` |
| 11 | D | Conduct, phones, appeals. Fair-play cases stay in Trust. Not move legality |
| 12 | D | Arbiter powers and penalties. Not a rules-library function |
| Appendix A Rapid | D for event procedure; E for "illegal move may stand" | Piece movement stays Article 3. The server never stands an illegal move. Rapid is a time-control category, not a second ruleset id |
| Appendix B Blitz | D / E | Same as Rapid |
| Appendix C | Output, not authority | The server emits canonical SAN after acceptance. Client SAN is not the move |
| Appendix D | D, with Chess One accessibility separate | Blindfold over-the-board procedure is not the web client. `TST-A11Y` is product access, not this appendix |
| Guidelines I adjournment | F | Not part of live online play under this ruleset |
| Guidelines II Chess960 | F | A different ruleset id would be required. Not `FIDE-E01-2023` |
| Guidelines III quickplay finishes | D | "Cannot win by normal means" is arbiter judgment. It is not an engine decision and not article 5.2.2 |

## 2. Critical cases / الحالات الحرجة

`UNKNOWN` في عمود النتيجة يعني أن دفتر الاختبار يثبت الشكل، بينما أثر الموت الكامل ما زال جزئيًا.

| Rule ID | Article | Interpretation | State needed | Expected result | Edge | Test |
|---|---|---|---|---|---|---|
| RULE-001 | 2, 3 | Initial position, white to move | Standard start | Twenty legal pawn or knight moves exist; e2e4 is legal | Black moving first is NotYourTurn | TST-RULE-E01-001 |
| RULE-002 | 3.10 | Illegal geometry | Start | e2e5 rejected | No state change | TST-RULE-E01-002 |
| RULE-003 | 3.1 | Cannot capture own piece | Start | White knight to a square of a white pawn is illegal | — | TST-RULE-E01-003 |
| RULE-004 | 3.1.3, 3.9 | Attack is not the same as a legal move. A pinned piece still attacks | Rook on the king's file behind a knight | The knight move off the file is illegal. The knight still attacks through the pin definition | Discovered check is the opener's move, not a new piece type | TST-RULE-E01-004 |
| RULE-005 | 3.9 | Check | Position in the ledger | A move leaving the king in check is illegal | Double check is still one king in check by two attackers | TST-RULE-E01-005 |
| RULE-006 | 3.8 | Kings cannot stand on adjacent squares | Ledger FEN | The step that makes them adjacent is illegal | — | TST-RULE-E01-006 |
| RULE-007 | 3.8.2 | Castling rights are historical, represented by the rights still available | Rights field, not a guess from square occupancy | Missing right makes castling illegal even if king and rook look unmoved | FEN rights can be wrong for an illegal diagram; 3.10.3 then applies | TST-RULE-E01-007 |
| RULE-008 | 3.8.2.2 | Cannot castle out of check, through check, or into check | Ledger | Kingside illegal while the crossed square is attacked; queenside still legal in that fixture | Path blocked by a piece is also illegal | TST-RULE-E01-008 |
| RULE-009 | 3.7.3.1 | En passant only with the recorded availability | ep square | exd6 legal | Availability expires after the next move | TST-RULE-E01-009 |
| RULE-010 | 3.9.2 | En passant that opens a line onto the mover's king is illegal | Ledger | IllegalMove, no capture | — | TST-RULE-E01-010 |
| RULE-011 | 3.7.3.3 | Promotion piece is mandatory and may be an underpromotion | Pawn on the seventh | Missing piece is InvalidState. q, r, b, and n are legal when the move is legal | Auto-queen forbidden | TST-RULE-E01-011 |
| RULE-012 | 5.1.1 | Checkmate ends immediately | Ledger | black_win or white_win, reason checkmate | A later flag does not replace it | TST-RULE-E01-012 |
| RULE-013 | 5.2.1 | Stalemate | Ledger | draw, stalemate | The king is not in check | TST-RULE-E01-013 |
| RULE-014 | 5.2.2 | Dead only when proven | K vs K, K+B vs K, K+N vs K | PROVEN_DEAD, draw dead_position | K+NN vs K must not be PROVEN_DEAD | TST-RULE-E01-014 |
| RULE-015 | 5.1.2 | Resignation | Command | NOT_DEAD: loss. Opponent proven unable to mate: draw resign_no_mate_possible (one-sided check, GAP-MATE-004) | UNKNOWN is MATING_POSSIBILITY_UNRESOLVED with no official result (DEC-064) | TST-RULE-E01-015 |
| RULE-016 | 6.9 | Timeout | Receipt after deadline, stamped in the writer's monotonic domain (DEC-063) | NOT_DEAD: loss. Opponent proven unable to mate: timeout_no_mate (one-sided check, GAP-MATE-004) | In-time mate beats a flag. Processing after receipt is not a flag. UNKNOWN is MATING_POSSIBILITY_UNRESOLVED with no official result (DEC-064) | TST-RULE-E01-016 |
| RULE-017 | 5.2.3 | Agreement | Both sides have moved; offer then accept | draw_agreed | Offer before both have moved is InvalidState | TST-RULE-E01-017 |
| RULE-018 | 9.2 | Threefold claim, not automatic on the third sight | History plus side, rights, ep | Correct claim draws. The third sight alone does not | Identity fails if only the piece squares match | TST-RULE-E01-018 |
| RULE-019 | 9.6.1 | Fivefold is automatic | Same identity, fifth appearance | draw fivefold without a claim | — | TST-RULE-E01-019 |
| RULE-020 | 9.3 | Fifty-move claim | Half-move clock and intended move | Correct claim draws. Move 50 without a claim continues | A pawn move or capture resets the count | TST-RULE-E01-020 |
| RULE-021 | 9.6.2 | Seventy-five automatic | Counter | draw seventy_five_move | Checkmate on that move wins | TST-RULE-E01-021 |
| RULE-022 | 9.5.3 | Incorrect claim | False threefold or fifty | No draw. Opponent +120000 ms. Legal indicated move is then played. Illegal indicated move is not | Not an abandonment timer | TST-RULE-E01-022 |
| RULE-023 | 9.2.3 | Repetition identity | History of rights and ep | Same squares with different castling rights are not the same position. Ep availability likewise | — | TST-RULE-E01-023 |

## 3. Unknowns left open / ما بقي مجهولًا

- GAP-MATE-001 وGAP-MATE-002 وGAP-MATE-003 في وثيقة إمكانية الكش مات.
- أوضاع البيدق المقفلة التي لا صورة كش مات لها: لا خوارزمية مدعاة.
- أنماط الساعة (زيادة أو تأخير) معاملات مباراة، وقائمة ما يُشحن في أول شريحة منتج ما زالت H.
- Chess960 والتأجيل خارج هذا المعرّف.
