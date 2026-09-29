# Contract Catalog v1 / فهرس العقود — الإصدار 1

**Normative for / معياري لـ:** command, event, outbox, reconnect, control lease, and local-import shapes.  
**Not a stack choice / ليس اختيار تقنية.** الحقول مفاهيم. لا أنواع لغة، ولا قاعدة بيانات، ولا بروتوكول منتج.

معرّفات اللاعبين والمجالات معرفات ثابتة (Stable IDs). الحدث يحمل أقل بيانات تكفي للمستهلك. الاسم المعروض والبريد وملف العقل ليست جزءًا من حدث المباراة.

## 1. Outbox / Event publication contract / عقد النشر بعد الحفظ

ينطبق على كل حدث تترتّب عليه حقيقة مجال آخر، وأولها `game.finished.v1` (DEC-040).

1. سلطة المجال تحسم الحقيقة داخل حدّها.
2. تُحفظ الحالة والنتيجة والأثر الداخلي في التزام دائم واحد مع سجل صادر (Outbox) في حد الملكية نفسه.
3. يرد المسار الحرج نجاحًا بعد هذا الالتزام. الرد لا ينتظر المستهلكين.
4. ناشر منفصل يقرأ السجل الصادر ويرسل الحدث.
5. فشل الناشر أو المستهلك لا يعيد فتح التزام المصدر ولا يلغي النتيجة.
6. كل مستهلك متماثل الأثر (Idempotent) على `event_id`.
7. إعادة المحاولة محدودة. لا حلقة لا نهائية.
8. بعد الحد، الرسالة تذهب إلى مسار الرسائل الميتة (Dead Letter) مع السبب، وتبقى قابلة للمراجعة.
9. إعادة التشغيل (Replay) تتم من السجل الدائم بمعرّفات الأحداث، لا من ذاكرة عميل.
10. إصدار الحدث جزء من الاسم المنطقي: `name.vN`. مستهلك لا يفهم الإصدار يرفض بأمان ولا يكتب حقيقة.

فشل التصنيف أو التحليل أو المكافآت أو الإحصاء أو الإشعارات أو Chess Land أو الذكاء الاصطناعي لا يلغي `GameResult`.

## 2. SubmitMoveCommand.v1

سلطة النقلة واحدة. العميل لا يثبت هويته بنفسه، ولا يثبت مقعده، ولا يثبت تدوين SAN.

### 2.1 Authority order / ترتيب السلطة

قبل أي فحص شرعية:

1. الجلسة المصادَق عليها (Authenticated Session) تُثبت اللاعب.
2. عقد التحكم الساري (Control Lease) يُثبت الجهاز المسموح له بالإرسال في هذه المباراة.
3. مقعد المباراة (Game Seat) يُستنتج على الخادم من الجلسة والعقد و`game_id`.
4. `actor_id` إن أُرسل حقل اختياري للمطابقة فقط. إذا غاب، المقعد يبقى مقعد الخادم. إذا وُجد وخالف المقعد المستنتج، الرد `Unauthorized` ولا تنفيذ. العميل لا يعيّن المقعد.
5. لا حقل لون ولا حقل FEN في هذا العقد. أي حقل غير مذكور هنا لا يمنح سلطة، ويُتجاهل.

### 2.2 Request concepts / مفاهيم الطلب

| Field | Required | Meaning |
|---|---|---|
| contract_version | yes | `"1"` |
| game_id | yes | Stable id of the live game |
| actor_id | no | Optional echo. Must match the server seat or the command is `Unauthorized`. It is not identity proof |
| session_id | yes | Authenticated session. The server binds it to the caller; a caller-chosen session id is not accepted |
| control_lease_id | yes | Active controller lease for the resolved seat in that game |
| client_command_id | yes | Idempotency key for this intent, scoped to this `game_id` and this seat |
| expected_game_sequence | yes | Sequence the client believes is current |
| from_square | yes | Departure square, file `a`–`h` and rank `1`–`8`. Case is normalized by the server |
| to_square | yes | Arrival square, same alphabet |
| promotion_piece | conditional | Required only when the pawn move reaches the promotion rank. Allowed values: `q`, `r`, `b`, `n`. Absent and empty are the same. Present on a non-promotion move is `InvalidState` |
| client_san | no | Display or input hint only. The server does not parse it as the move |
| client_observed_at | no | Informational. Never owns the clock |

التبييت يُرسل كحركة الملك مربعين (`e1`→`g1` أو `e1`→`c1` وما يقابلها للأسود). الأخذ بالتجاوز يُرسل بالمربعين فقط، ومربع القطعة المأسورة يشتقّه الخادم من الحالة المرجعية.

لا يُقبل UCI ولا SAN بديلًا عن `from_square` و`to_square`. الخادم قد يصدر UCI لاحقًا كترميز مشتق من هذه الحقول الثلاثة للسجل وللعامل، وهذا الإصدار الصادر ليس مدخلًا ثانيًا للأمر.

### 2.3 Server processing / معالجة الخادم

1. التحقق من شكل المربعات ومن الترقية. الشكل غير الصالح: `InvalidState` بلا تنفيذ.
2. التحقق من الجلسة والعقد والمقعد و`actor_id` كما في 2.1.
3. سلوك `client_command_id` كما في 2.5. قرار مُلزِم سابق يُعاد ولا يُعاد تنفيذه.
4. إذا كانت المباراة منتهية وهذا المعرّف ليس قرار القبول المخزّن: `GameAlreadyFinished`.  
   **Later approved correction (LIVE-CONTRACT-004, RESOLVED, see 2.6.1):** for a new command with no stored binding, `GameAlreadyFinished` is a non-binding rejection. A bound command id is still decided at step 3, before this guard. / تصحيح معتمد لاحق: الرفض هنا لا يُلزم المعرّف.
5. إذا لم يكن المقعد هو صاحب النوبة: `NotYourTurn`.
6. إذا خالف `expected_game_sequence` تسلسل الخادم: `StaleSequence` بلا كتابة.
7. الموعد النهائي يُقارن بزمن الاستلام الرتيب (monotonic receipt) كما في `LIVE_GAME_EVENT_ORDERING_V1.md`. `received_at` هو هذا الزمن، مختومًا داخل مجال الساعة الرتيبة لكاتب المباراة الحية (DEC-063). `applied_at` زمن الالتزام بعد الفحص، ولا يُستخدم لخصم وقت المعالجة من اللاعب. أمر وصل قبل الموعد يبقى في الوقت حتى لو اكتمل الفحص بعده. أمر وصل بعد الموعد لا يُطبَّق. تعويض التأخير الشبكي (Lag compensation) غير معتمد.
8. الخادم يعيد بناء النقلة من الحالة المرجعية والمربعات، ويطلب من Chess Rules Library الحكم. الرفض: `IllegalMove`.
9. عند القبول يولّد الخادم Canonical SAN، ويحدّث الحالة والساعة والتسلسل، ثم يحفظ الالتزام. SAN العميل لا يُخزَّن كالنقلة المرجعية.

### 2.4 Server-owned fields on accept / حقول يملكها الخادم عند القبول

`received_at`, `applied_at`, `resulting_game_sequence`, authoritative clock snapshot, canonical SAN, derived UCI if the server emits it, accept/reject code, `replayed_response`.  
وقت العميل لا يُخصم ولا يُضاف إلى الساعة.  
قيم الساعة المرجعية أعداد صحيحة بوحدة المللي ثانية. لا تُخزَّن الساعة كعدد عشري ثنائي.

### 2.5 Response categories / فئات الرد

| Code | Meaning | State change |
|---|---|---|
| Accepted | Legal move applied at the next sequence, or the original accept is being replayed | One move on first accept only |
| IllegalMove | Rules library rejected the move, or that rejection is being replayed | No |
| NotYourTurn | Resolved seat is not the side to move, or that rejection is being replayed | No |
| StaleSequence | `expected_game_sequence` does not match the server | No. This response does not lock `client_command_id` |
| Unauthorized | Missing/invalid session or lease, superseded lease, or `actor_id` mismatch | No. This response does not lock `client_command_id` |
| GameAlreadyFinished | Result already committed and this command is not the stored accept | No. This response does not lock `client_command_id` and stores no binding (LIVE-CONTRACT-004, 2.6.1) |
| InvalidState | Unusable shape, including a promotion field that the position does not require, or a missing promotion on a promotion move | No, until a binding decision is stored for a well-formed command |
| InvalidCommandIdentity | Same `client_command_id` already has a binding decision, and the semantic payload differs | No execution |

`replayed_response` حقل في كل رد. قيمته `true` فقط عند إعادة قرار مُلزِم مخزّن دون تنفيذ جديد. الرد الأول يحمل `false`. إعادة `Accepted` تبقى `Accepted` مع `replayed_response = true`. لا تُستبدل بنتيجة توحي أن النقلة رُفضت.

### 2.6 Idempotency and stale behavior / التكرار والتسلسل القديم

البصمة الدلالية للأمر هي: `game_id` + `from_square` + `to_square` + `promotion_piece` بعد تطبيع الحالة والفراغ.  
خارج البصمة: `client_observed_at` و`client_san` و`actor_id` و`expected_game_sequence` و`session_id` و`control_lease_id`.  
*Superseded wording (Phase 0.5) on one point:* `control_lease_id` is no longer outside the fingerprint. See 2.6.2 (LIVE-CONTRACT-005).

قرار مُلزِم هو: `Accepted` أو `IllegalMove` أو `NotYourTurn` أو `InvalidState` على أمر مكتمل الشكل وصل إلى حكم.  
`StaleSequence` و`Unauthorized` لا يقفلان المعرّف، لأنهما لا يحسمان النقلة ولا يكتبان حالة. `GameAlreadyFinished` لا يقفل المعرّف (LIVE-CONTRACT-004، القسم 2.6.1).  
*Superseded wording (Phase 0.5):* this list originally also named `GameAlreadyFinished` as a binding decision. That entry is withdrawn by LIVE-CONTRACT-004.

- بعد قرار مُلزِم، نفس المعرّف مع نفس البصمة: أعد القرار الأصلي مع `replayed_response = true`. لا نقلة ثانية. `Accepted` يبقى `Accepted` حتى لو تغيّر التسلسل الذي يرسله العميل في إعادة المحاولة، وحتى لو انتهت المباراة بعد تلك النقلة.
- بعد قرار مُلزِم، نفس المعرّف مع بصمة مختلفة: `InvalidCommandIdentity` ولا تنفيذ.
- معرّف لم يُقفل بعد، وتسلسل قديم: `StaleSequence` بلا كتابة. إعادة نفس المعرّف بعد المزامنة ما زالت ممكنة.
- طلبان متطابقان يصلان معًا: الكاتب الواحد يسلسلهما. الأول يُنتج القرار المُلزِم، والثاني يستلمه كإعادة.
- المعرّف خاص بالمباراة وبالمقعد الذي قُفل عليه. مستدعٍ ليس ذلك المقعد لا يستلم جسم القرار الأصلي؛ الرد `Unauthorized`.
- أمر لم يُقبل من قبل، والمباراة منتهية: `GameAlreadyFinished`، رفض غير مُلزِم (LIVE-CONTRACT-004).

### 2.6.1 Later approved correction — LIVE-CONTRACT-004 (RESOLVED) / تصحيح معتمد لاحق

Approved by the owner after the Phase 1 Batch 5.2 review (2026-09-28). This corrects 2.3 step 4, the 2.5 row, and the 2.6 binding list above. The earlier wording is kept above as superseded, not erased.

For a game whose status is already finished:

| Command | Result |
|---|---|
| New, previously unbound `client_command_id` | `GameAlreadyFinished`, a non-binding rejection. The authoritative state is returned unchanged (the same state object in the implementation): no sequence, clock, position, history, or status change, no event, and no new command binding. The same command sent again is evaluated again and answers `GameAlreadyFinished` again, with `replayed_response = false` |
| Already bound id, same fingerprint | The original stored response, with `replayed_response = true`. The identity check (step 3) still runs before the terminal guard (step 4) |
| Already bound id, different fingerprint | `InvalidCommandIdentity`, no execution |

Reason: a finished game is an absorbing state. A post-terminal binding protects no authoritative transition, and storing one for every new id would let a client grow the binding store without limit after the game ends.

المباراة المنتهية حالة ماصّة. الأمر الجديد بعد النهاية يُرفض بـ `GameAlreadyFinished` دون تخزين قرار مُلزِم ودون أي تغيير في الحالة. الأمر المُلزِم سابقًا يُعاد قراره الأصلي، والبصمة المختلفة `InvalidCommandIdentity`.

### 2.6.2 Later approved correction — LIVE-CONTRACT-005, lease-scoped fingerprint (RESOLVED) / تصحيح معتمد لاحق

Approved by the owner in the Phase 1 Batch 5.1 review and recorded here in Batch 6 (2026-09-28). This corrects the "outside the fingerprint" list in 2.6 above, which is kept as superseded wording.

The semantic fingerprint includes the normalized authoritative `control_lease_id`, after authorization has checked it against the seat's current lease:

| Command | Fingerprint |
|---|---|
| `SubmitMoveCommand.v1` | command name and version, `game_id`, `control_lease_id`, normalized `from_square`, `to_square`, `promotion_piece` |
| `ClaimDrawCommand.v1` | command name and version, `game_id`, `control_lease_id`, `claim_kind`, and the normalized intended move when present |
| `ResignGameCommand.v1` | command name and version, `game_id`, `control_lease_id` only |

Still outside the fingerprint: `client_observed_at`, `client_san`, `actor_id`, `expected_game_sequence`, `session_id`, and `client_command_id` (the lookup key together with the seat).

Reason: without the lease, a controller holding a replacement lease could send an earlier `client_command_id` with the same payload and receive, as a replay, a decision stored under the earlier lease. With it, that command is `InvalidCommandIdentity` with no execution; the same id, payload, and original lease still replays.

البصمة تشمل عقد التحكم بعد التحقق منه. جهاز بعقد بديل لا يستلم قرارًا خُزّن تحت عقد سابق.

### 2.7 Critical-path ban / ممنوعات المسار الحرج

معالج هذا الأمر لا ينتظر: تحليلًا، ذكاءً اصطناعيًا، متجرًا، إشعارًا، بحثًا، Chess Land، تصنيفًا، شهادة، تدريبًا، إحصاءً، أو استدعاءً متزامنًا لخدمة أعلام الميزات.  
بعد الالتزام يُكتب أثر صادر لـ `game.move_accepted.v1` إن لزم النشر للمشاهدين أو القياس. هذا النشر خارج رد اللاعب.

## 3. Reconnect and sync state machine / آلة حالات المزامنة

لا رقم زمني للهجر في هذه الآلة (DEC-042).

| State | Clock | Who may send moves | What the client may trust |
|---|---|---|---|
| ActiveControlled | Server clock runs | The device holding the current lease | Latest server snapshot |
| ViewOnly | Server clock runs | Nobody on this device | Server snapshot for display |
| TransportInterrupted | Server clock keeps running | Nobody until resync | Local board is display-only and stale |
| ResyncRequired | Server clock runs | Nobody | Client must send last seen sequence plus lease |
| Resyncing | Server clock runs | Nobody | In-flight server snapshot |
| LeaseSuperseded | Server clock runs | Old lease rejected | Must drop controller role |
| AbandonmentEvaluation | Policy-defined; threshold TBD | No, if policy has already ended the game | Server result only |
| GameFinished | Stopped at commit | Nobody | Committed result |

انتقالات ملزمة:

- ActiveControlled → TransportInterrupted عند سقوط المقبس أو تحديث المتصفح أو خلفية الهاتف. الساعة لا تتوقف.
- TransportInterrupted → ResyncRequired عندما يعود النقل.
- ResyncRequired → Resyncing → ActiveControlled أو ViewOnly حسب عقد التحكم الحالي.
- أي جهاز بلا عقد حالي يبقى ViewOnly.
- ActiveControlled → LeaseSuperseded على الجهاز القديم عند نجاح استلام التحكم.
- أي حالة لعب → GameFinished عندما تُلتزم النتيجة.
- AbandonmentEvaluation تُدخل فقط بسياسة مهيأة. قيمة العتبة TBD. غياب الرقم يعني أن المواصفة لا تفترض خسارة تلقائية بمدة مخترعة.

العميل لا يكتب فوق حالة الخادم. اللقطة المرجعية هي الرد.

## 4. Control lease / عقد التحكم

مباراة تنافسية نشطة: عقد تحكم واحد سارٍ لكل لاعب (DEC-043).

حقول مفهومية يصدرها الخادم: `game_id`, `actor_id`, `control_lease_id`, `session_id`, `device_id`, `issued_at`, `supersedes_lease_id`.  
`actor_id` داخل العقد هو المقعد الذي ربطه الخادم بالجلسة. العميل لا يختار هذه القيمة.

استلام التحكم لاحقًا، إن فُعّل منتجيًا:

1. التحقق من الهوية والجلسة.
2. إصدار عقد جديد.
3. إلغاء العقد القديم.
4. رفض الأوامر التي تحمل العقد القديم بـ `Unauthorized`.
5. تسجيل AuditEvent.
6. إعادة Sync من الحالة الخادمية لكلا الجهازين.

لا تقنية تنفيذ هنا. تفعيل الاستلام نفسه لا يضيف رقم مهلة.

## 5. game.finished.v1

| Field | Required | Rule |
|---|---|---|
| event_id | yes | Globally unique, stable for replay |
| event_name | yes | `game.finished` |
| event_version | yes | `1` |
| occurred_at | yes | Server time of the durable commit |
| game_id | yes | Aggregate id |
| game_sequence | yes | Final authoritative sequence |
| ruleset_id | yes | Explicit ruleset version stored on the game. New games use `FIDE-E01-2023` until a later ruleset is separately approved. The event copies the game's stored id |
| player_ids | yes | Stable ids for the seats. No display names, email, or mind data |
| result_code | yes | `white_win`, `black_win`, `draw`, `aborted` |
| termination_reason | yes | Coarse code: `checkmate`, `resignation`, `time`, `draw_agreed`, `draw_rule`, `abandonment`, `aborted` |
| draw_rule_detail | when `termination_reason` is `draw_rule` | Engineering code for `FIDE-E01-2023`: `stalemate`, `dead_position`, `threefold_claim`, `fifty_move_claim`, `fivefold`, `seventy_five_move`, `timeout_no_mate`, `resign_no_mate_possible`. A later ruleset defines its own detail set |
| final_clock | yes | Authoritative clock snapshot at commit |
| producer | yes | `live_game_authority` |
| provenance | yes | Command/sequence reference that closed the game |

لا يُنشر هذا الحدث من حالة `MATING_POSSIBILITY_UNRESOLVED` (DEC-064).

*Later status (Phase 1 Batch 8, LIVE-CONTRACT-003 RESOLVED, pending review):* `event_id` is assigned at the persistence boundary when the event is written to the outbox in the same transaction as the final state, and is stored once, so it is stable for replay. `occurred_at` is the outbox row's commit-transaction time. The table above is unchanged. See `PHASE_0_DECISION_CHANGELOG.md` section 17. Batch 8.1 verified this on a local PostgreSQL 18.6 test database (changelog section 18). / حالة لاحقة: يُسند `event_id` عند حدود الحفظ داخل معاملة الحالة النهائية نفسها.

المستهلكون المتوقعون، وكلهم خارج المعاملة الحرجة: Rating, Analysis, Rewards, Statistics, Notifications, Career projection, Mind evidence, Chess Land, Tournament standings.  
كل مستهلك يتجاهل `event_id` الذي طبّقه. فشل أحدهم لا يستدعي تعويضًا من نواة المباراة.

تصنيف اللاعب ليس داخل هذا الحدث. التصنيف ينشر `rating.updated.v1` لاحقًا. خوارزمية التصنيف H.

## 6. Other architecture-critical events / أحداث حرجة أخرى

الحقول الدنيا المشتركة: `event_id`, `event_name`, `event_version`, `occurred_at`, aggregate id, sequence إن وُجد، `producer`.  
الحمولة الزائدة TBD تبقى TBD. لا حقول شخصية بلا لزوم.

| Event | Producer | Minimal payload already fixed | Consumers | Isolation |
|---|---|---|---|---|
| `game.created.v1` | Live Game | game_id, player ids, time-control id, rated flag | Realtime, audit | Create path, not an existing-game move |
| `game.started.v1` | Live Game | game_id, start sequence, server start time | Realtime. Fair-play intake is async | Fair-play delay must not block start |
| `game.move_accepted.v1` | Live Game | game_id, sequence, server seat id, structured squares, server canonical SAN, clock snapshot | Spectator fanout, telemetry | After commit. Fanout loss does not undo the move. Client SAN is not in the payload |
| `game.abandoned.v1` | Live Game | game_id, sequence, ruleset_id, reason | Rating/policy, fair play, analytics | Only after a committed abandonment result. Threshold TBD |
| `game.finished.v1` | Live Game | Section 5 | Async consumers | Outbox |
| `rating.updated.v1` | Rating | player_id, pool_id, rating snapshot, source event_id, algorithm_id | Profile projection, leaderboards, notifications | algorithm_id is an open reference, not Glicko-2 approval |
| `account.created.v1` | Identity | account_id | Profile, notifications | No secrets |
| `guest.claimed.v1` | Identity | account_id, guest_id, which history classes were attached | Profile, career | Proof method is not in the payload. Method remains H |
| `feature.disabled.v1` | Admin | flag_id, scope, new state | Snapshot refreshers | Move path uses last snapshot |

أحداث EVT-001 حتى EVT-040 في المتن التاريخي تبقى أسماء مصدر. حيث يطابق الاسم حدثًا في هذا الفهرس، نسخة `.v1` هي العقد. حيث لا يطابق، الحمولة H ولا تُنفَّذ كسلوك إنتاجي نهائي.

## 7. Local import / verification contract / عقد الاستيراد المحلي

النتيجة المحلية ليست نتيجة رسمية (DEC-044). العقد المستقبلي، عند فتحه بقرار لاحق، يحمل على الأقل:

- `import_id`
- source kind: `local_play`
- client-produced game record (moves, alleged result) marked unverified
- `ruleset_id` claim
- requesting account id

المسار المسموح: التحقق يعيد بناء الشرعية. الناتج المعتمد يُنشأ كسجل مستورد داخل مجاله، ويرتبط بالحساب فقط إذا نجح التحقق. هذا السجل لا يحدّث `RatingState` ولا ترتيب بطولة ولا دفتر مكافآت تنافسية ولا CareerEvent المرجعي إلا بعقد لاحق صريح ما زال غير معتمد.

لا يُفتح هذا المسار كمنتج في هذه الدفعة.

## 8. Guest claim contract shape / شكل عقد تثبيت الضيف

القدرة A (DEC-041). الحقول التالية شكل فقط:

- `guest_id`
- `target_account_id` or new-account request
- `proof_method` — value set is **H/TBD**. No method is approved here
- `history_classes` requested for attachment

SQ-DGM-10 يبقى صحيحًا كقدرة: لعب ثم طلب تثبيت ثم إرفاق التاريخ المؤهل بعد تحقق. خطوة «تحقق من إثبات الملكية» موجودة ولا تُغلق بطريقة محددة.

ترتيب إطلاق الضيف في أول MVP عام: H/TBD (DEC-052).

## 9. Compatibility / التوافق

عميل أقدم يبقى مدعومًا فقط داخل سياسة دعم لم تُرقَّم بعد (H). حتى تُعتمد السياسة، العقد الجديد يُضاف بإصدار جديد ولا يُكسر معنى إصدار منشور. لا نافذة N-1 مخترعة في هذه الدفعة.

## 10. Draw, offer, and resignation commands / أوامر التعادل والاستقالة

هذه أوامر توثيق فقط. لا تنفيذ في هذه الدفعة. كلها أوامر سلطة المباراة الحية.  
*Later status:* `ClaimDrawCommand.v1` (Phase 1 Batch 5), `ResignGameCommand.v1` (Batch 6), and `OfferDrawCommand.v1` and `RespondDrawOfferCommand.v1` (Batch 7) are implemented in the pure in-memory live-game authority, as written in 10.2 and 10.3: out-of-rule offers and responses are `InvalidState`, `offer_id` is the game sequence that committed the offer, and a committed move by the recipient declines the offer. Implementation choices within these sections are recorded in `PHASE_1_IMPLEMENTATION_LOG.md` (Batch 7). العميل لا يرسل نتيجة، ولا FEN، ولا SAN كسلطة.

الحقول المشتركة مع `SubmitMoveCommand.v1`: `contract_version`, `game_id`, `session_id`, `control_lease_id`, `client_command_id`, `expected_game_sequence`, و`actor_id` الاختياري للمطابقة فقط. ترتيب السلطة في القسم 2.1 ينطبق. `replayed_response` ينطبق. البصمة تشمل نوع الأمر وحقوله الدلالية، لا وقت العميل.

الساعة: المقارنة بزمن الاستلام الرتيب. دقيقتا المادة 9.5.3 تساوي 120000 مللي ثانية تُضاف إلى رصيد الخصم، وهي أثر `FIDE-E01-2023` وليست مهلة هجر.

### 10.1 ClaimDrawCommand.v1

| Field | Required | Meaning |
|---|---|---|
| claim_kind | yes | `threefold_current`, `threefold_intended`, `fifty_move_current`, `fifty_move_intended` |
| from_square, to_square, promotion_piece | when kind ends in `_intended` | The intended move, same square authority as a move command |

| Outcome | When | State |
|---|---|---|
| Accepted draw | The claim matches article 9.2 or 9.3 for `FIDE-E01-2023` | Game finishes. Detail `threefold_claim` or `fifty_move_claim`. An intended move that completes a true claim is part of the draw and is not a separate rejected move |
| IncorrectClaim | The claim is not true | No draw. Opponent's remaining time increases by 120000 ms. If an intended move was named and is legal, that move is then applied and the clock charge uses receipt time. An illegal intended move is not applied |
| IllegalMove | Used only when a named intended move is illegal and the incorrect-claim path above already states it is not applied | No move |
| Same response codes as section 2.5 | Unauthorized, StaleSequence, InvalidState, InvalidCommandIdentity, NotYourTurn, GameAlreadyFinished | No stolen result |

صاحب النوبة فقط يطالب. المطالبة الثلاثية أو الخمسين ليست تلقائية بمجرد ظهور الوضع. التكرار الخماسي وقاعدة الخمس والسبعين يكتشفها الخادم دون هذا الأمر.

فصل الاتصال أثناء الفحص لا يوقف الساعة (DEC-042). الفحص على الخادم فوري، ولا يُمنح اللاعب إيقافًا ماديًا كما في قاعة اللعب.

### 10.2 OfferDrawCommand.v1

يُقبل الشكل فقط إذا كان دور الخصم بعد نقلة مكتملة من مقدّم العرض، وكان الطرفان قد لعبا نقلة واحدة على الأقل، وإلا `InvalidState` بلا عرض. لا شروط مرفقة. العرض يبقى حتى القبول أو الرفض أو انتهاء المباراة بسبب آخر. نقلة من المستلم تُعد رفضًا. إعادة نفس `client_command_id` بنفس البصمة تعيد القرار الأصلي.

**Later approved policy — LIVE-OFFER-006 (RESOLVED, Batch 7 closure): one draw offer per committed move.** A player may make at most one offer based on their most recent committed move. After a decline, a new offer by the same player on the same move is `InvalidState` (detail `draw_offer_already_used_for_move`); a new opportunity exists only after another legal move is committed. No time cooldown or numeric quota applies. / عرض تعادل واحد لكل نقلة ملتزمة: بعد الرفض لا يعيد اللاعب العرض قبل نقلة قانونية جديدة.

### 10.3 RespondDrawOfferCommand.v1

| Field | Required | Meaning |
|---|---|---|
| offer_id | yes | The server id of the pending offer |
| decision | yes | `accept` or `decline` |

`accept` مع شرط المادة 5.2.3 ينهي المباراة بـ `draw_agreed`. `decline` يُسقط العرض وتستمر المباراة. لا عرض معلّق: `InvalidState`. القبول لا يُنشئ تعادلًا إذا انتهت المباراة قبل الالتزام.

### 10.4 ResignGameCommand.v1

لا حقول نقلة. دالة إمكانية الكش مات في `MATING_POSSIBILITY_AND_DEAD_POSITION_RESEARCH_V1.md` تحدد الأثر:

- `NOT_DEAD`: المقعد المستقيل يخسر.
- إثبات أن الخصم لا يستطيع الكش مات بأي سلسلة: تعادل، والتفصيل `resign_no_mate_possible`. هذا فحص من طرف واحد غير موجود بعد (GAP-MATE-004). موضع `PROVEN_DEAD` كله انتهى أصلًا بالمادة 5.2.2، فالاستقالة فيه `InvalidState`.
- `UNKNOWN`: `MATING_POSSIBILITY_UNRESOLVED`. لا فوز ولا خسارة ولا تعادل رسمي، ولا `game.finished.v1` (DEC-064).

*Superseded wording (Phase 0), on the first bullet:* the whole-position `NOT_DEAD` criterion is replaced by 10.5. *Superseded wording (Phase 0), on the second bullet:* "فالاستقالة فيه `InvalidState`" (a resignation there is `InvalidState`) is SUPERSEDED by LIVE-CONTRACT-006 (RESOLVED) below: the response is `GameAlreadyFinished`.

### 10.5 Later approved correction — LIVE-CONTRACT-001, one-sided adjudication of time and resignation (RESOLVED) / تصحيح معتمد لاحق

Approved direction recorded after the Phase 1 Batch 5 review; implemented and resolved in Phase 1 Batch 6 (2026-09-28). This corrects 10.4 above and the "`NOT_DEAD` → loss on time" wording in `LIVE_GAME_EVENT_ORDERING_V1.md` section 3.

When player X flags (6.9) or resigns (5.1.2), let Y be X's opponent. The question is one-sided: can Y checkmate X by any possible series of legal moves (Article 3.10.1) from the current position? `assessMatingCapability(position, Y)` in `@chess-one/chess-rules` answers it. The answer depends on the position alone. Repetition history, fivefold repetition, the halfmove clock, and the seventy-five-move rule end an ongoing game; they do not decide whether such a series exists, and they are not inputs (Phase 1 Batch 6.1 correction).

| Capability of Y | Flag | Resignation |
|---|---|---|
| `PROVEN_CAN_MATE` | Y wins, `termination_reason = time` | Y wins, `termination_reason = resignation` |
| `PROVEN_CANNOT_MATE` | Draw, `draw_rule`, `timeout_no_mate` | Draw, `draw_rule`, `resign_no_mate_possible` |
| `UNKNOWN` | `MATING_POSSIBILITY_UNRESOLVED`, no result, no `game.finished.v1` | Same |

- Whole-position `NOT_DEAD` is not sufficient: it does not say which side can mate. In K+Q versus K, if the queen side flags, the lone king cannot mate and the result is a draw, not a loss.
- `UNKNOWN` stays mandatory and first-class. It is never mapped to a win, loss, or draw (DEC-064). Not every position is decided: see research section 9.
- A resolved flag or resignation commits once, emits `game.finished.v1` once in the same decision, and is bound to the client command that caused it. A flag found by the writer's own deadline check has no client command and binds nothing.
- **LIVE-RESIGN-001 (RESOLVED, owner-approved in Batch 6.1):** a player may resign on either turn. A resignation received at or before the active side's deadline (`received_at <= deadline`) is timely and processed as a resignation. One received after it (`received_at > deadline`) is not: the active side's flag occurred first, and timeout adjudication takes precedence (`MoveReceivedAfterDeadline`, bound). No other ordering applies.

**LIVE-CONTRACT-006 (RESOLVED, owner-approved in Batch 6.1):** a new resignation command that arrives after the game has already finished, for example as a dead position under 5.2.2, is answered `GameAlreadyFinished`, a non-binding rejection, not `InvalidState`. Reason: a terminal game state is absorbing, and every new unbound command meets the same terminal guard (2.6.1, LIVE-CONTRACT-004). The `InvalidState` wording in 10.4 is SUPERSEDED.

عند سقوط علم X أو استقالته، يُسأل: هل يستطيع الخصم Y الكش مات بأي سلسلة قانونية؟ نعم مُثبتة: فوز Y. لا مُثبتة: تعادل. غير معروف: `MATING_POSSIBILITY_UNRESOLVED` بلا نتيجة.

## 11. Realtime protocol `chess_one.realtime.v1` / بروتوكول الاتصال الفوري

Added in Phase 1 Batch 9 (2026-09-29), pending review; decisions LIVE-RT-001 to 016. It carries the commands of sections 2 and 10 unchanged; it adds no game rule. Section 3 (reconnect) is realized in part: see 11.6.

### 11.1 Connection / الاتصال

- `GET /realtime`, exact path, no query string, WebSocket upgrade, subprotocol `chess_one.realtime.v1`. The version is fixed for the connection.
- Refused before the handshake with an HTTP status and a JSON body `{ "code": ... }`: `NOT_FOUND` 404, `BAD_UPGRADE` 400, `UNSUPPORTED_PROTOCOL_VERSION` 400, `ORIGIN_NOT_ALLOWED` 403 (exact allowlist), `CREDENTIAL_TOO_LARGE` 400, `UNAUTHENTICATED` 401, `SESSION_UNAVAILABLE` 503, `SERVER_BUSY` 503, `SERVER_SHUTTING_DOWN` 503.
- Credentials travel in the upgrade's `Authorization` or `Cookie` header and are resolved by the server's trusted session resolver into an actor and its seat grants (`gameId`, `seat`, `controlLeaseId`). The client never states identity, seat, or lease in a message.
- The first message must be `hello` within the handshake timeout; the server answers `connection_ready`.
- Frames: UTF-8 text JSON only, one message per frame, at most the advertised `maxMessageBytes` (4096 by default, never above 16384).
- Close codes: 1000, 1002, 1008, 1009 only (LIVE-RT-014).

### 11.2 Client messages / رسائل العميل

Flat JSON objects with a `type`; unknown fields are errors; no arrays; depth at most 2. `requestId` and `nonce` are optional, 1 to 64 of `[A-Za-z0-9._:-]`, and are echoed.

| `type` | Fields | Meaning |
|---|---|---|
| `hello` | `protocol` = `chess_one.realtime.v1` | Opens the session |
| `ping` | `nonce?` | Application liveness; answered `pong` |
| `sync_game` | `requestId?`, `gameId` | Subscribe to a granted game and receive its snapshot |
| `game_command` | `requestId?`, `command` | One of the five v1 commands of sections 2 and 10, with exactly their fields. Server-owned fields (`received_at`, sequence, SAN, result, clock) are refused as unknown |

### 11.3 Server messages / رسائل الخادم

| `type` | Fields | When |
|---|---|---|
| `connection_ready` | `protocol`, `actorId`, `games` (`gameId`, `seat`), `limits` | After `hello` |
| `game_snapshot` | `requestId`, `snapshot` | Answer to `sync_game` |
| `game_update` | `snapshot` | After every committed transition, to every subscriber, after the issuer's response |
| `command_response` | `requestId`, `response` | The decision (section 2.5 codes), sent only after the commit; `replayed` marks a stored response |
| `recovery_required` | `requestId`, `gameId`, `reason`, `clientCommandId` | Play is paused until an operator recovery, and the request decided nothing. `reason`: `RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED` (the stored clock anchor belongs to another clock domain), `PERSISTENCE_UNAVAILABLE` (a load, commit, or create failed in this process), `WRITER_FAULT` (the writer hit an unexpected exception; no error text is sent), `CONCURRENCY_OWNERSHIP_UNCERTAIN` (the stored sequence moved under the writer, so another writer may own the game; the database may be healthy; Batch 9.2), or `CREATE_RECONCILIATION_REQUIRED` (a create reported failed could not be confirmed either way; Batch 9.2). `clientCommandId` is the refused command's id, or null; that id stays unbound. Sent with `requestId: null` to every subscriber when an infrastructure pause begins. Balances are the last committed ones, and downtime is never charged (Batch 9.1) |
| `sync_required` | `gameId`, `reason` = `WRITER_STOPPED` | The client must `sync_game` again |
| `request_failed` | `requestId`, `code`, `retryable`, `clientCommandId` | `GAME_ACCESS_DENIED`, `GAME_NOT_FOUND`, `GAME_UNAVAILABLE`, `SUBSCRIPTION_LIMIT`, or `TEMPORARILY_UNAVAILABLE` (retryable) |
| `server_busy` | `requestId`, `code`, `retryable` = true, `clientCommandId` | `RATE_LIMITED`, `WRITER_QUEUE_FULL`, `WRITER_CAPACITY`; the command was not received |
| `protocol_error` | `code`, `field` | The message was invalid; `field` is a schema field name or null |
| `pong` | `nonce` | Answer to `ping` |

Four failure families stay distinct: `protocol_error` (the client sent something invalid), a non-`Accepted` `command_response` (a domain decision), `request_failed`/`server_busy` (the server could not serve it now), and `recovery_required`.

### 11.4 `game_snapshot.v1`

A client format, separate from the stored `live_game_state.v1`: `format`, `gameId`, `rulesetId`, `sequence`, `positionFen`, `sideToMove`, `seat` (this connection's), `status` (`active`; `finished` with `resultCode`, `terminationReason`, `winner`, `drawRuleDetails`; or `unresolved` with `reason` and `side`), `playable` (true only while running), `recoveryRequired`, `recoveryReason` (one of the `recovery_required` reasons, or null; Batch 9.1), `clock` (`whiteMs`, `blackMs`, `activeSide`, `running`: balances as of the snapshot, clamped at 0; while paused, the stored balances with `running: false`), and `pendingDrawOffer` (`offerId`, `offeredBy`, `offeredTo`, or null). It never contains a monotonic anchor, `received_at`, binding, fingerprint, control lease, player id, clock domain, or database detail. A `command_response` carries the committed balances the same way, without anchors.

### 11.5 Receipt, order, and delivery / الاستلام والترتيب والتسليم

- A command is received when its game's single writer accepts it into its queue; `received_at` is stamped then by the writer's monotonic clock (LIVE-RT-002). A refused command was not received and may be resent with the same `clientCommandId`.
- Commands and deadline checks of one game are decided one at a time in receipt order. `received_at <= deadline` is timely (LIVE-RT-005).
- The issuer gets `command_response` before any subscriber gets the `game_update` of that decision. Per connection and game, state messages never go below a sequence already sent.
- A connection that cannot keep up is closed (1008), never left open with a gap (LIVE-RT-007). The recovery for any doubt is reconnect and `sync_game`.

### 11.6 Reconnect / إعادة الاتصال

- A disconnect changes nothing: the server clock keeps running and the writer still flags at the deadline (section 3, TransportInterrupted).
- On reconnect the client sends `hello`, then `sync_game`; the snapshot is the authority (ResyncRequired → Resyncing → ActiveControlled for a granted seat). An uncertain command is resent with the same `clientCommandId` and replays.
- Not realized yet: ViewOnly, LeaseSuperseded, lease takeover, and AbandonmentEvaluation (LIVE-MULTI-CONNECTION-001, LIVE-VIEW-ONLY-001).

الاتصال عبر WebSocket بالبروتوكول الفرعي `chess_one.realtime.v1`. الهوية والمقعد وعقد التحكم من الجلسة الموثوقة فقط. زمن الاستلام يختمه كاتب اللعبة الوحيد عند قبول الأمر في طابوره. الرد يسبق التحديث، ولا يُرسل تسلسل أقل مما أُرسل. عند الشك: إعادة اتصال ثم مزامنة.
