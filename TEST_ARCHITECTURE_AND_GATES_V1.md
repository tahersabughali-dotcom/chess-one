# Test Architecture and Gates v1 / معمارية الاختبار والبوابات — الإصدار 1

**Purpose / الغرض:** استبدال قائمة «Test/Inspection» العامة بمعرّفات عائلات قابلة للتتبع.  
**Implementation status / حالة التنفيذ:** لا شيفرة ولا حزمة اختبار في هذه الدفعة. هذا عقد الاختبار الذي تُبنى عليه المرحلة اللاحقة بعد فتحها.  
**Golden rule / قاعدة الذهب:** مجموعة TST-RULE الذهبية مربوطة الآن بـ `FIDE-E01-2023` (DEC-051 = A). لا تُغلق كاختبارات منفَّذة في هذه الدفعة، ولا تُستبدل بمسودة FIDE لاحقة.

كل عائلة تختبر، حيث ينطبق: نجاح، فشل، إعادة محاولة، مهلة، طلب مكرر، رفض صلاحية، انقطاع جزئي، إعادة اتصال، بيانات قديمة.

## 1. Families / العائلات

| ID | Family | What it proves | Examples of cases | Gate |
|---|---|---|---|---|
| TST-RULE | Chess rules | Legality and terminal facts for `FIDE-E01-2023` | Section 6 checklist. Each case names the handbook article it maps. No law text is copied into the assertion | Spec checklist open. Executable suite starts only in a later phase |
| TST-STATE | Canonical state | One sequence, no client overwrite, result immutable by clients | Accept then reject a second writer, client snapshot ignored, finished game rejects moves | Required before live-game implementation |
| TST-CLOCK | Authoritative clock | Server monotonic receipt owns elapsed time | Refresh, socket drop, and background do not pause the server clock. Client timestamp does not change the clock. A move received before the deadline still counts if apply finishes late. A move received after the deadline is a flag. Wall clock is display and audit | No numeric abandonment assertion. No lag-compensation assertion |
| TST-COMMAND | SubmitMoveCommand.v1 | One authority model and idempotency | Accepted once; replay of that accept stays Accepted with `replayed_response = true`; IllegalMove; NotYourTurn; StaleSequence does not lock the command id; same id plus different squares is `InvalidCommandIdentity` and applies nothing; Unauthorized; `actor_id` mismatch does not grant a seat; GameAlreadyFinished; InvalidState when promotion is missing or unexpected; client SAN is not the stored move; server emits canonical SAN | Required before live-game implementation |
| TST-RECONNECT | Resync state machine | Recovery without local authority | TransportInterrupted keeps server clock, resync returns server sequence, ViewOnly cannot move, superseded lease cannot move | Abandonment duration not asserted |
| TST-CONTRACT | Versioned events and outbox | Persist-then-publish | `game.finished.v1` exists only after durable result. Consumer failure does not roll back. Duplicate event_id is a no-op. Unknown version is rejected | Required before async consumers |
| TST-SECURITY | Threat model | Server-side controls in the threat model | Lease bypass, cross-route engine help during a rated game, guest claim without an approved proof, audit delete denied, foreign service writing a result, bad realtime origin | Child-age cases stay unspecified until MIS-008 |
| TST-FAILURE | Isolation | Smallest failure stays small | Analysis down, AI down, store down, flag service down, spectator fanout down, engine worker down during a human game | Human game still accepts moves |
| TST-RTL | Arabic RTL / English LTR | First-class layout | Arabic shell mirrors. English shell does not. SAN, FEN, and PGN keep standard notation direction | Required for any future UI |
| TST-A11Y | Accessibility | Baseline access | Keyboard reach to board actions, reduced motion does not block moves, contrast mode does not change legality | Required for any future game UI |
| TST-LOAD | Load | Staged capacity, including a tournament start herd | Arrival spike, many game starts, spectator fanout separated from move accept | Targets stay TBD. No 1M claim as a launch promise |
| TST-SOAK | Soak | Leaks and clock drift over time | Long-running games, reconnect churn, outbox backlog | Duration of the soak run is a later test plan number, not an abandonment rule |
| TST-BACKUP | Backup / restore | Restore of authoritative games | Restore then resync. A restored game does not accept a move already in the sequence | Required before production data. Not before this documentation batch |

## 2. Required mappings / الربط الإلزامي

| Requirement cluster | Primary test family |
|---|---|
| FR-GM-002, FR-GM-003, DEC-045 rules library | TST-RULE, TST-STATE |
| FR-GM-002 clock, DEC-042 | TST-CLOCK |
| FR-P0 move contract | TST-COMMAND |
| FR-GM-004, SQ-DGM-02, DEC-043 | TST-RECONNECT |
| FR-ARC-003, DEC-040, UC-GM-10 | TST-CONTRACT |
| FR-AI-003, FR-AI-004, DEC-047 | TST-SECURITY |
| FR-GM-005, NFR-ISO-003, DEC-046 | TST-FAILURE |
| FR-ID-007 | TST-RTL |
| FR-ID-008 | TST-A11Y |
| NFR-SCL-002 | TST-LOAD |
| UC-TS-06, NFR-REL-002 | TST-BACKUP |
| Local play DEC-044 | TST-STATE: local result object is not a GameResult |

التتبع صفًا صفًا في `TRACEABILITY_MATRIX_V2.md`.

## 3. Gates that block production behavior / بوابات تمنع تجميد السلوك الإنتاجي

| Gate | Status | What cannot be frozen |
|---|---|---|
| RULESET-FIDE-VERSION / DEC-051 | A for `FIDE-E01-2023` | A later FIDE text. This pin is closed. Executable golden tests are still not written |
| Rating algorithm / CON-005 | G/H | Numeric rating updates |
| Move Quality and Chess Mind formulas / Q-04, Q-05 | H | Public scores |
| Guest proof method | H | Attaching guest history |
| Abandonment threshold | H | Automatic loss after a specific duration |
| MVP boundary / DEC-052 | H | Calling any slice the approved public MVP |
| Child policy / MIS-008 | H | Child accounts, chat, and purchases |
| Mating possibility adjudication / DEC-064 | H for the final policy | Mapping `UNKNOWN` to a win, loss, or draw |
| Stack families / DEC-056 | A for the families in the stack record | Treating a patch number as immutable architecture; installing beta/RC/canary; adding Redis, a broker, Kubernetes, Go, or Rust on day one |

قائمة القسم 6 هي عقد الاختبار لـ `FIDE-E01-2023`. وسم «ناجح إنتاجيًا» يبقى ممنوعًا حتى تُنفَّذ المجموعة لاحقًا وتُراجع. لا شيفرة اختبار في هذه الدفعة.

## 4. Property checks / فحوص الخصائص

هذه خصائص يجب أن تبقى صحيحة لكل تسلسل أوامر، بعد فتح التنفيذ لاحقًا:

- لا حالة قطع غير قانونية بعد أمر مقبول.
- تسلسل المباراة يزيد بمقدار نقلة واحدة عند Accepted فقط.
- ساعة الخادم لا تعود إلى الوراء لأن عميلًا أرسل وقتًا أقدم.
- تأخير المعالجة بعد استلام في الموعد لا ينقص الرصيد عن قيمة زمن الاستلام.
- `UNKNOWN` من كاشف الكش مات لا يُنتج فوزًا ولا خسارة ولا تعادلًا رسميًا، ولا `game.finished.v1` (DEC-064).
- لا معرّف أمر واحد ينتج نقلتين.
- إعادة قرار `Accepted` تبقى `Accepted` مع `replayed_response = true`.
- نفس `client_command_id` مع مربعات أو ترقية مختلفة لا يُنفَّذ، والرد `InvalidCommandIdentity`.
- `actor_id` المخالف لمقعد الجلسة والعقد لا يغيّر المقعد.
- SAN العميل لا يصبح SAN المرجعي.
- `game.finished.v1` لا يُرى للمستهلك قبل وجود GameResult ملتزم.
- مستهلك متعطل لا يغيّر GameResult.
- جهاز ViewOnly لا ينتج Accepted.

## 5. Traceability rule / قاعدة التتبع

اختبار بلا معرّف عائلة لا يُغلق متطلبًا. متطلب بلا عائلة في مصفوفة v2 يبقى TBD ولا يُعتبر مغطى.

## 6. FIDE-E01-2023 behavior checklist / قائمة سلوك خط الأساس

المصدر الرسمي، بلا نسخ لنص القانون: FIDE Handbook, Laws of Chess taking effect from 1 January 2023, English authentic text approved 2022-08-07, applied 2023-01-01.  
`https://handbook.fide.com/chapter/e012023`  
المعرّف: `FIDE-E01-2023`. مكتبة القواعد تستدعى بهذا المعرّف. مباراة قديمة لا تُعاد قراءتها بمعرّف أحدث.

كل سطر اختبار يربط موضعًا ونقلة ونتيجة متوقعة برقم المادة. نص المادة لا يُلصق داخل الاختبار.

| Check | Article map | Engineering behavior |
|---|---|---|
| Initial position and side to move | 2, 3 | The library starts from the standard initial position unless the game aggregate supplies another position created under this same ruleset |
| Line pieces and knights | 3.2–3.6 | Movement, blocking, and capture match those articles |
| Pawn step, double step, capture | 3.7.1–3.7.3 | Double step only from the pawn's first square, and both squares empty |
| En passant | 3.7.3.1–3.7.3.2 | Legal only on the immediate next move. The captured square is derived |
| Promotion | 3.7.3.3–3.7.3.5 | Explicit `q`/`r`/`b`/`n`, including a piece still on the board. Effect is immediate. Missing or surplus promotion is `InvalidState`. The server does not auto-queen |
| King step and castling | 3.8–3.8.2.2 | Castling is the king moving two squares. Rights and the attacked-square restrictions are library checks |
| Check and pin | 3.9 | A move that leaves the own king in check is illegal |
| Checkmate | 5.1.1 | Immediate win for the mover |
| Resignation | 5.1.2 | Loss for the resigner, except a draw when the opponent has no mating sequence. Detail `resign_no_mate_possible` |
| Stalemate | 5.2.1 | Immediate draw. Detail `stalemate` |
| Dead position | 5.2.2 | Immediate draw when neither side has a mating sequence. This is wider than a short material list. Detail `dead_position` |
| Agreement | 5.2.3 | Draw only after both sides have made at least one move. Coarse reason `draw_agreed` |
| Flag | 6.9 | Authoritative elapsed time ends at the writer's monotonic `received_at` (DEC-061, DEC-063). If `received_at` is after the deadline, the move is not applied. Processing after a timely receipt is not player time. `applied_at` is commit and audit time only. Client time is never authoritative. `NOT_DEAD` is a loss on time; an opponent proven unable to mate gives `timeout_no_mate` (one-sided check, GAP-MATE-004); `UNKNOWN` is `MATING_POSSIBILITY_UNRESOLVED` with no official result (DEC-064). An already finished game is unchanged |
| Threefold claim | 9.2, 9.2.3 | Claim by the side to move, not an automatic draw on the third occurrence. Identity includes side to move, castling rights, and en passant availability |
| Fifty-move claim | 9.3 | Claim by the side to move, not automatic at move 50 |
| Incorrect claim | 9.5.2, 9.5.3 | No draw. Opponent's remaining time increases by two minutes. An illegal indicated move is not applied. Those two minutes are a rules consequence, not the abandonment threshold |
| Clock during claim | 9.5.1 mapped to DEC-042 | The server judges the claim inline. Disconnect does not pause the authoritative clock |
| Fivefold | 9.6.1 | Automatic draw. Detail `fivefold` |
| Seventy-five moves | 9.6.2 | Automatic draw, except a checkmate on that move still wins. Detail `seventy_five_move` |

خارج مسار أمر النقلة، وتبقى في المصدر للرجوع لا كسلوك مكتبة القواعد:

- اللمس والتحريك المادي، المادة 4.
- سلم العقوبات بعد نقلة غير قانونية اكتملت على الرقعة المادية، المادة 7.5. الخادم يرفض النقلة قبل الالتزام، فالمباراة الرقمية لا تدخل هذا السلم.
- بقاء نقلة غير قانونية في السريع والبرق إذا أكمل الخصم، الملحق A.5.2 وما يقابله في البرق. المسار الرقمي لا يُكمل نقلة غير قانونية.
- ورقة التسجيل، التأجيل، سلوك اللاعبين، وسلطات الحكم التقديرية، المواد 8 و11 و12 والملاحق الإرشادية.
- «لا يمكن الفوز بالوسائل العادية» في نهاية اللعب السريع حكم بشري، وليس قرار محرك تلقائي.

اختبارات الحدود المستقبلية للمستودع، عند وجود شيفرة لاحقًا، تتبع DEC-058 ولا تُكتب في هذه الدفعة.  
صفوف التغطية الذهبية في `CHESS_RULES_GOLDEN_TEST_LEDGER_V1.md`. الفجوات هناك تبقى فجوات.
