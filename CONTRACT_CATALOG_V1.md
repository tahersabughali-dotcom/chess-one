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

*Amended by Phase 1 Batch 11.2 (2026-09-29, GACC-016, changelog section 24), pending review.* The fingerprint and the rule "same `client_command_id`, different command identity → `InvalidCommandIdentity`" are unchanged. What changed is which lease the comparison uses for a command id that is already bound:

- **Current control lease:** authority for new commands. A new command is authorized against it and bound under it, as before.
- **Historical stored lease:** identity evidence for commands already bound. A resend of a bound id is compared with the stored fingerprint rebuilt under the lease stored in that binding, never under the caller's current lease.

So a previously bound exact semantic command replays its stored decision (`replayed_response = true`) even when the caller now holds a different control lease; the same id with a different command is `InvalidCommandIdentity`. The superseded sentence in the reason above ("With it, that command is `InvalidCommandIdentity`") no longer applies to an exact resend. Replay stays read-only: an earlier lease never authorizes a new command, and the stored decision is only returned to the seat that bound it (section 13.3).

*Batch 11.3 (changelog section 25):* this lease rule is unchanged. A resend of a bound id is recognized by the game's writer before it is received, so it is never stamped or admitted (section 13.3).

*تعديل الدفعة 11.2:* عقد التحكم الحالي سلطة للأوامر الجديدة فقط. العقد المحفوظ داخل الربط دليل هوية للأوامر المربوطة سابقًا. الأمر المطابق تمامًا يُعاد قراره المخزّن حتى لو كان المرسل يحمل عقدًا آخر الآن، والمعرّف نفسه مع أمر مختلف `InvalidCommandIdentity`.

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

*Batch 11 (2026-09-29), pending review; changelog section 22.* Realized for players: the conceptual `session_id` is the controlling session stored per seat, and `actor_id` the seat from the game's assignment. Takeover is the explicit `claim_game_control` (section 13): steps 1 to 4 and 6 are implemented (identity and session checked; a new lease issued; the old lease refused by the game's writer, as `CONTROL_NOT_HELD` rather than `Unauthorized`, from the moment the rotation is queued; both devices told and able to resync). Step 5 is a fact, not yet a durable AuditEvent (GAME-CONTROL-EVENT-001). `device_id`, `issued_at`, and `supersedes_lease_id` are not stored; the record keeps a `control_version` instead. The lease never leaves the server.

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
- *Batch 10:* the production resolver reads only the session cookie (section 12); the `Authorization` header is not a credential there. A connection whose session ends is closed 1008 with reason `session_ended`, or `session_unverifiable` if the session store cannot answer the periodic recheck (AUTH-REVOCATION-001).
- *Batch 11:* the resolver no longer returns seat grants with leases. It returns the actor, a listing of the user's seats (what `connection_ready.games` shows; it grants nothing), and the session's game authority, which answers every seat, control, and claim question from the store (section 13).

### 11.2 Client messages / رسائل العميل

Flat JSON objects with a `type`; unknown fields are errors; no arrays; depth at most 2. `requestId` and `nonce` are optional, 1 to 64 of `[A-Za-z0-9._:-]`, and are echoed.

| `type` | Fields | Meaning |
|---|---|---|
| `hello` | `protocol` = `chess_one.realtime.v1` | Opens the session |
| `ping` | `nonce?` | Application liveness; answered `pong` |
| `sync_game` | `requestId?`, `gameId` | Subscribe to a granted game and receive its snapshot |
| `claim_game_control` | `requestId?`, `gameId` | *Batch 11.* Take control of this session's seat in the game (section 13) |
| `game_command` | `requestId?`, `command` | One of the five v1 commands of sections 2 and 10, with exactly their fields. Server-owned fields (`received_at`, sequence, SAN, result, clock) are refused as unknown. *Batch 11:* `controlLeaseId` is optional; if sent it is still length-checked, then discarded, and the server uses the lease this session holds |

### 11.3 Server messages / رسائل الخادم

| `type` | Fields | When |
|---|---|---|
| `connection_ready` | `protocol`, `actorId`, `games` (`gameId`, `seat`), `limits` | After `hello` |
| `game_snapshot` | `requestId`, `snapshot` | Answer to `sync_game` |
| `game_update` | `snapshot` | After every committed transition, to every subscriber, after the issuer's response |
| `command_response` | `requestId`, `response` | The decision (section 2.5 codes), sent only after the commit; `replayed` marks a stored response |
| `recovery_required` | `requestId`, `gameId`, `reason`, `clientCommandId` | Play is paused until an operator recovery, and the request decided nothing. `reason`: `RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED` (the stored clock anchor belongs to another clock domain), `PERSISTENCE_UNAVAILABLE` (a load, commit, or create failed in this process), `WRITER_FAULT` (the writer hit an unexpected exception; no error text is sent), `CONCURRENCY_OWNERSHIP_UNCERTAIN` (the stored sequence moved under the writer, so another writer may own the game; the database may be healthy; Batch 9.2), or `CREATE_RECONCILIATION_REQUIRED` (a create reported failed could not be confirmed either way; Batch 9.2). `clientCommandId` is the refused command's id, or null; that id stays unbound. Sent with `requestId: null` to every subscriber when an infrastructure pause begins. Balances are the last committed ones, and downtime is never charged (Batch 9.1) |
| `sync_required` | `gameId`, `reason` = `WRITER_STOPPED` | The client must `sync_game` again |
| `control_granted` | `requestId`, `gameId`, `seat` | *Batch 11.* This session controls the seat. `requestId` is null when another connection of the same session claimed it |
| `control_denied` | `requestId`, `gameId`, `code`, `retryable` | *Batch 11.* The claim took nothing: `GAME_ACCESS_DENIED`, `GAME_CLOSED`, `SESSION_ENDED`, `RATE_LIMITED`, `CONFLICT`, `TEMPORARILY_UNAVAILABLE` |
| `control_revoked` | `gameId`, `seat`, `code` | *Batch 11.* This session lost control: `CONTROL_TRANSFERRED` (another session of the same player claimed it) or `CONTROL_RELEASED` (logout, revocation, account closed, expiry). A courtesy: the writer refuses the old lease whether or not it arrives. Never names who took the seat |
| `request_failed` | `requestId`, `code`, `retryable`, `clientCommandId` | `GAME_ACCESS_DENIED`, `GAME_NOT_FOUND`, `GAME_UNAVAILABLE`, `SUBSCRIPTION_LIMIT`, or `TEMPORARILY_UNAVAILABLE` (retryable). *Batch 11:* `CONTROL_NOT_HELD` (not retryable as is): this session does not control the seat, and the command was not received, queued, stamped, or bound; claim, then send again. `GAME_ACCESS_DENIED` now also answers a game that does not exist, so a stranger cannot tell the two apart. *Batch 11.1:* `CONTROL_NOT_HELD` is sent only when the id is also not one this seat already bound (section 13.3). `INVALID_COMMAND_IDENTITY` (not retryable): without control, the id is bound to a different command; nothing was decided or returned. *Batch 11.3:* the same answer for the session that controls the seat; `TEMPORARILY_UNAVAILABLE` also answers a new command id reaching a writer that had not yet loaded a running game: it was not received, and sending it again is stamped then (section 13.3) |
| `server_busy` | `requestId`, `code`, `retryable` = true, `clientCommandId` | `RATE_LIMITED`, `WRITER_QUEUE_FULL`, `WRITER_CAPACITY`; the command was not received |
| `protocol_error` | `code`, `field` | The message was invalid; `field` is a schema field name or null |
| `pong` | `nonce` | Answer to `ping` |

Four failure families stay distinct: `protocol_error` (the client sent something invalid), a non-`Accepted` `command_response` (a domain decision), `request_failed`/`server_busy` (the server could not serve it now), and `recovery_required`.

### 11.4 `game_snapshot.v1`

A client format, separate from the stored `live_game_state.v1`: `format`, `gameId`, `rulesetId`, `sequence`, `positionFen`, `sideToMove`, `seat` (this connection's), `status` (`active`; `finished` with `resultCode`, `terminationReason`, `winner`, `drawRuleDetails`; or `unresolved` with `reason` and `side`), `playable` (true only while running), `recoveryRequired`, `recoveryReason` (one of the `recovery_required` reasons, or null; Batch 9.1), `clock` (`whiteMs`, `blackMs`, `activeSide`, `running`: balances as of the snapshot, clamped at 0; while paused, the stored balances with `running: false`), and `pendingDrawOffer` (`offerId`, `offeredBy`, `offeredTo`, or null). It never contains a monotonic anchor, `received_at`, binding, fingerprint, control lease, player id, clock domain, or database detail. A `command_response` carries the committed balances the same way, without anchors.

*Batch 11:* two fields are added: `controlHeld` (this session controls `seat` now, so its commands are admitted) and `canClaimControl` (not held and the game `active`). Still no session id, lease, internal id, or the opponent's user id.

### 11.5 Receipt, order, and delivery / الاستلام والترتيب والتسليم

- A command is received when its game's single writer accepts it into its queue; `received_at` is stamped then by the writer's monotonic clock (LIVE-RT-002). A refused command was not received and may be resent with the same `clientCommandId`.
- Commands and deadline checks of one game are decided one at a time in receipt order. `received_at <= deadline` is timely (LIVE-RT-005).
- The issuer gets `command_response` before any subscriber gets the `game_update` of that decision. Per connection and game, state messages never go below a sequence already sent.
- A connection that cannot keep up is closed (1008), never left open with a gap (LIVE-RT-007). The recovery for any doubt is reconnect and `sync_game`.

### 11.6 Reconnect / إعادة الاتصال

- A disconnect changes nothing: the server clock keeps running and the writer still flags at the deadline (section 3, TransportInterrupted).
- On reconnect the client sends `hello`, then `sync_game`; the snapshot is the authority (ResyncRequired → Resyncing → ActiveControlled for a granted seat). An uncertain command is resent with the same `clientCommandId` and replays.
- Not realized yet: ViewOnly, LeaseSuperseded, lease takeover, and AbandonmentEvaluation (LIVE-MULTI-CONNECTION-001, LIVE-VIEW-ONLY-001).
- *Batch 11:* lease takeover and LeaseSuperseded are realized for players (section 13). A reconnect of the same session keeps control and its lease; another session of the same player resyncs with `controlHeld: false` and claims to play. *Superseded by Batch 11.1:* ~~A former controller's exact resend is answered from storage only on the connection that held the lease; after a reconnect it gets `CONTROL_NOT_HELD` and resyncs to learn the outcome (GAME-CONTROL-REPLAY-RECONNECT-001).~~ ViewOnly for non-players and AbandonmentEvaluation stay unrealized (LIVE-VIEW-ONLY-001).
- *Batch 11.1:* an uncertain command of a session that no longer controls the seat is resent with the same `clientCommandId` on any connection of any active session of the same player, also after a server restart, and replays from storage (section 13.3; GAME-CONTROL-REPLAY-RECONNECT-001 RESOLVED). *Batch 11.2:* the same holds for the session that controls the seat now, under a newer lease (GACC-016 RESOLVED). *Batch 11.3:* for every session the resend is a read-only lookup, never a new receipt: no `received_at`, no clock effect (section 13.3, GACC-017).

الاتصال عبر WebSocket بالبروتوكول الفرعي `chess_one.realtime.v1`. الهوية والمقعد وعقد التحكم من الجلسة الموثوقة فقط. زمن الاستلام يختمه كاتب اللعبة الوحيد عند قبول الأمر في طابوره. الرد يسبق التحديث، ولا يُرسل تسلسل أقل مما أُرسل. عند الشك: إعادة اتصال ثم مزامنة.

## 12. Authentication API `/auth` / واجهة المصادقة

Added in Phase 1 Batch 10 (2026-09-29) and amended by Batch 10.1, pending review; decisions AUTH-* in changelog sections 20 and 21. Served by the realtime edge on the same origin as `/realtime`.

### 12.1 Session cookie / ملف تعريف الجلسة

- Production: `__Host-chess_one_session=<token>; Path=/; Max-Age=<seconds to absolute expiry>; HttpOnly; Secure; SameSite=Lax`, no `Domain`. Test/loopback only: `chess_one_session`, the same without `Secure`.
- The token is 43 base64url characters (256 random bits). It is the only credential; it never appears in a body. Clearing: the same name with an empty value and `Max-Age=0`.
- A request with a duplicated or malformed session cookie is unauthenticated (fail closed).

### 12.2 Request rules / قواعد الطلب

- State changes are `POST` or `DELETE`. Every non-GET request must carry an allowlisted `Origin` (else 403 `ORIGIN_NOT_ALLOWED`); every `POST` must be `application/json` (else 415 `UNSUPPORTED_MEDIA_TYPE`); `Sec-Fetch-Site: cross-site` is refused on every route (403). No CORS headers are sent.
- Bodies: one flat JSON object with exactly the listed string members, at most 8192 bytes (413 `PAYLOAD_TOO_LARGE`); duplicate keys, extra or missing members, non-strings, and malformed JSON are 400 `INVALID_REQUEST`. No body member names a user, session owner, role, or seat.
- New passwords (`password` on register, `newPassword` on change and reset; Batch 10.1, AUTH-PASSWORD-002): 15 to 256 Unicode code points, used exactly as sent (never trimmed, normalized, or truncated); spaces allowed; no composition rules. Refusals are 400 `VALIDATION_FAILED` with `field` and `reason` `too_short` (fewer than 15), `too_long` (more than 256), `malformed_unicode`, `control_characters`, `matches_account_identifier` (equals the username or email in any case), or `compromised`. A login `password` is only checked to be non-empty, well-formed, and at most 256 code points. `email` is required on registration (AUTH-EMAIL-REQUIRED-001). There is no username-change route (AUTH-USERNAME-RENAME-001).

### 12.3 Routes / المسارات

| Route | Body | Success | Notes |
|---|---|---|---|
| `POST /auth/register` | `username`, `email`, `password` | 201 `auth_user.v1` + cookie | Signs in at once, verified or not. 409 `USERNAME_UNAVAILABLE` / `EMAIL_UNAVAILABLE` (bare codes, no explanatory text; the email answer still discloses registration, AUTH-ENUMERATION-001) |
| `POST /auth/login` | `identifier` (username or email), `password` | 200 `auth_user.v1` + new cookie | 401 `INVALID_CREDENTIALS` for unknown account and wrong password alike; 403 `ACCOUNT_UNAVAILABLE` only after the correct password |
| `POST /auth/logout` | `{}` | 204, cookie cleared | Idempotent; no session needed |
| `POST /auth/logout-all` | `{}` | 204, cookie cleared | Ends every session of the user, the current one included |
| `GET /auth/me` | none | 200 `auth_user.v1` | |
| `GET /auth/sessions` | none | 200 `auth_sessions.v1` | Live sessions, current one marked |
| `DELETE /auth/sessions/:sessionId` | none | 204 (cookie cleared if it was the current session) | Another user's or an unknown id is 404 `NOT_FOUND` |
| `POST /auth/password` | `currentPassword`, `newPassword` | 200 `auth_user.v1` + new cookie | Ends every session, then signs this device in again. Wrong current password 403 `INVALID_CREDENTIALS` |
| `POST /auth/password-reset/request` | `email` | 202 | Same answer whether or not the address has an account |
| `POST /auth/password-reset/confirm` | `token`, `newPassword` | 204 | Single use; ends every session; signs nobody in. 400 `INVALID_TOKEN` |
| `POST /auth/email-verification/request` | `{}` | 202 | Needs a session; 409 `ALREADY_VERIFIED` |
| `POST /auth/email-verification/confirm` | `token` | 204 | Single use. 400 `INVALID_TOKEN` |

Authenticated routes answer 401 `UNAUTHENTICATED` without a valid session, and clear a presented cookie. Any other path or method under `/auth` is 404 `NOT_FOUND`. Reset and verification answer 501 `FEATURE_UNAVAILABLE` when no delivery channel is configured.

### 12.4 Wire formats / صيغ الرسائل

- `auth_user.v1`: `{ "format": "auth_user.v1", "user": { "userId", "username", "status", "emailVerified" } }`. `status` is `active` here. `emailVerified` is what future high-trust features will require (AUTH-EMAIL-VERIFIED-001); nothing requires it yet. No email address, hash, token, or internal field.
- `auth_sessions.v1`: `{ "format": "auth_sessions.v1", "sessions": [ { "sessionId", "createdAt", "lastSeenAt", "current" } ] }`, times in epoch milliseconds.
- `auth_error.v1`: `{ "format": "auth_error.v1", "code", "field"?, "reason"?, "retryAfterMs"? }`. Codes: `INVALID_REQUEST`, `VALIDATION_FAILED` (with `field` and a policy `reason` such as `too_short`), `INVALID_TOKEN`, `INVALID_CREDENTIALS`, `UNAUTHENTICATED`, `ACCOUNT_UNAVAILABLE`, `ORIGIN_NOT_ALLOWED`, `NOT_FOUND`, `USERNAME_UNAVAILABLE`, `EMAIL_UNAVAILABLE`, `ALREADY_VERIFIED`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `RATE_LIMITED` (429, with `retryAfterMs` and `Retry-After`), `FEATURE_UNAVAILABLE` (501), `SERVICE_BUSY` (503, `Retry-After: 1`), `SERVICE_UNAVAILABLE` (503). No error carries SQL, SQLSTATE, a table name, or a stack.

### 12.5 Realtime link / الربط مع الاتصال الفوري

The `/realtime` upgrade authenticates with the same cookie (section 11.1). The actor is the account's `userId`; seats and control leases come from game assignment, never from the session or the client. Ending a session closes its sockets (1008 `session_ended`).

*Batch 11:* realized by game access (section 13). Ending a session also releases every seat it controls (logout, logout-all, revoke one, password change or reset, session limit, expiry), and disabling or locking an account releases every seat of the user's games; nothing is resigned and no other session is given control.

المصادقة بملف تعريف جلسة HttpOnly فقط، ولا يحمل أي جسم رسالة هوية المستخدم أو مقعده. رسالة فشل الدخول واحدة للحساب غير الموجود ولكلمة المرور الخاطئة. تسجيل الخروج يُنهي الجلسة في قاعدة البيانات ويغلق اتصالاتها المفتوحة فورًا.

## 13. Game access and seat control / الوصول إلى المباراة والتحكم بالمقعد

Added in Phase 1 Batch 11 (2026-09-29), pending review; decisions GACC-001 to GACC-014 in changelog section 22, GACC-015 and GACC-016 (Batch 11.1) in section 23, and the resolution of GACC-016 (Batch 11.2) in section 24, and GACC-017 (Batch 11.3: a historical replay is never an authoritative receipt) in section 25. It realizes section 4 for players and the authority order of section 2.1 through the realtime protocol of section 11, which stays `chess_one.realtime.v1`: every change is a new message, code, or snapshot field, and a client `controlLeaseId` is still accepted (length-checked, then discarded).

### 13.1 Authority chain / سلسلة السلطة

1. The session cookie proves the account (`userId`, section 12).
2. The game's assignment gives the seat: exactly two different accounts, one per seat, fixed at creation. Nobody else has access; a game that does not exist and a game of other players get the same answer (`GAME_ACCESS_DENIED`).
3. The seat's control record names the one session that controls it, if any.
4. That session's control lease is filled into the command by the server (the `control_lease_id` of section 2.2 is server-supplied; the client never sends or sees it).
5. The game's single writer admits the command only if the lease is the seat's lease as of the end of its queue; otherwise `CONTROL_NOT_HELD`, and nothing is received, queued, stamped, or bound.
6. The live-game core validates the command as before.

*Batch 11.1:* a command that is not admitted at step 5 (or is sent by a session without control) is looked up, read-only, as a historical replay of the seat's stored bindings (section 13.3) before `CONTROL_NOT_HELD` is sent.

### 13.2 Control / التحكم

- One controlling session per seat. A new game starts with no controller; each player claims once. Access (sync) never takes control.
- `claim_game_control` by the holder keeps its lease; by another session of the same player it issues a new lease, makes that session the holder, and makes the old lease inadmissible from the moment the rotation is queued. The previous holder's connections get `control_revoked CONTROL_TRANSFERRED`.
- There is no silent takeover: a second session syncs with `controlHeld: false` and must claim.
- Claims are refused for non-players (`GAME_ACCESS_DENIED`), ended sessions (`SESSION_ENDED`), finished or rules-unresolved games (`GAME_CLOSED`), too many claims (`RATE_LIMITED`), and a control record changed by another process (`CONFLICT`); a store outage is `TEMPORARILY_UNAVAILABLE`. A refused claim changes nothing.
- A claim changes no clock, sequence, position, repetition history, result, or outbox row. It works during a recovery pause and does not resume the game.
- Ending a session releases the seats it controls; closing an account releases every seat of its games. A released seat has no controller and a fresh lease; nothing is resigned and no other session is given control. The released connections get `control_revoked CONTROL_RELEASED` if they are still open.

### 13.3 Replay after a control change / إعادة الإرسال بعد تغيير التحكم

*Batch 11.1 (2026-09-29), pending review; GACC-015 and GACC-016 in changelog section 23. Replaces the Batch 11 wording (connection memory of the last 64 ids), which is superseded. Batch 11.2 (changelog section 24) extends the same rule to the current controller; see the unified rule at the end of this section.*

- A command admitted under a lease keeps its stored decision; the binding store remains the idempotency authority, and it is the only one. No connection memory decides a replay.
- A session that does not control the seat may resend a command its seat already bound and receives the stored decision unchanged, with `replayed: true`. This holds on the same connection, after a reconnect, from any other active session of the same player, and after a server restart.
- Before any lookup, the server proves in its stores that the session is still active and that its user is the player assigned to the seat. Control is not required. A replay grants no authority: the session still cannot send a new command without claiming.
- The server rebuilds the command's fingerprint (section 2.6.2) with the control lease stored in the binding itself and answers only if it equals the stored fingerprint exactly. The client never names a lease, and neither the lease nor the fingerprint is ever sent.
- A command id the seat never bound is `CONTROL_NOT_HELD`: nothing is received, stamped, or bound. The same id with a different command is `INVALID_COMMAND_IDENTITY`, and nothing is decided or returned.
- The lookup is limited to the requester's own seat. The opponent resending the same id finds nothing of the other seat (`CONTROL_NOT_HELD`); a non-player gets `GAME_ACCESS_DENIED`; an ended, expired, or logged-out session cannot connect at all.
- A replay changes no sequence, binding, clock, position, outbox row, or control record.
- ~~The current controller is still under section 2.6.2: resending an id bound under an earlier lease is `InvalidCommandIdentity` (a command response), not a replay (GACC-016).~~ *Superseded by Batch 11.2.*

**Unified rule (Batch 11.2, GACC-016 RESOLVED).** For every authenticated session of the player assigned to the seat, whether or not it controls the seat, on the same or a new connection, and after a restart:

1. Look up the durable binding by `game_id`, the requester's own seat, and `client_command_id`.
2. If a binding exists: an exact semantic match, judged under the lease stored in the binding (section 2.6.2 as amended), returns the stored response with `replayed_response = true`; any other command is an identity conflict. Nothing is admitted, stamped, bound, charged to the clock, sequenced, or written to the outbox.
3. Only if no binding exists does control matter: without control, `CONTROL_NOT_HELD`; with control, the normal new-command path.

~~The identity conflict reaches the client in the family of the path that found it: the controller's command is decided by the live game, so it is a `command_response` with code `InvalidCommandIdentity`; a session without control is never decided for, so it is `request_failed INVALID_COMMAND_IDENTITY`. Both mean the same thing and change nothing.~~ *Superseded by Batch 11.3.*

~~A command admitted under the current lease is recognized in the live game's identity step (catalog 2.3 step 3), so a controller's resend costs no extra read; a command not admitted under it (no control, or the lease rotated away) is recognized by the read-only historical lookup above.~~ *Superseded by Batch 11.3: the controller's resend was stamped and queued as a new command before its binding was found.*

**A historical replay is never an authoritative receipt (Batch 11.3, changelog section 25, GACC-017).** A replay is read-only and works the same whatever the caller's control, connection, or session:

- A command id already bound for the seat is never received. It gets no `received_at` (section 2.3 item 7, DEC-063), no clock reading, and no admission as a new command. The stored response is returned with `replayed_response = true`. The same id with a different command is `request_failed INVALID_COMMAND_IDENTITY` (not retryable) for every session, controller or not; it is never a `command_response` and carries no receipt time. Nothing changes: clock, sequence, position, bindings, outbox, and control lease.
- The durable binding store is the only source of truth. The game's writer keeps in memory the game state it last loaded or committed itself, bindings included. It uses that copy at ingress, with no database read, to tell a bound id from a new one. A binding, once committed, is never removed, so an id found there is certainly bound. The writer never treats an id as new just because its memory lacks it: an id counts as new only when the writer has loaded the game and no job still queued ahead could bind that id.
- A new command id, admitted under the seat's current lease on a writer that has loaded the game, is stamped at ingress with one reading of the writer's monotonic clock, before any database access. No database latency is charged to the player.
- A command the writer cannot yet classify is only looked up, never stamped. That happens when the writer has not loaded the game, or when an earlier command with the same id is still queued. The lookup runs in queue order on a fresh load. A bound id is replayed, or it is an identity conflict. An unbound id without control is `CONTROL_NOT_HELD`. An unbound id with control on a game whose clock runs in this process's clock domain is **not received**: `request_failed TEMPORARILY_UNAVAILABLE` (retryable), with nothing stamped, decided, or bound, and sending it again is stamped at ingress. Stamping it after the load would charge the database read to the player, so it is refused instead. When no clock runs here (the game is finished, rules-unresolved, or paused for recovery), the command is received after the load, which charges nothing, and it gets the normal answer, for example `recovery_required`.
- First load and restart. A running game enters play through `startGame`, which loads its writer before returning (LIVE-WRITER-ACTIVATION-001), and a running writer never retires. So every command to a running game in this process meets a loaded writer. A new process is a new clock domain, so every stored running game it finds is paused for recovery. The not-received answer above is therefore a fail-safe, not a path a player normally takes. After a restart, the first request with an old bound id is a replay or a conflict from the stored binding, with no receipt.

*الدفعة 11.3:* إعادة الإرسال التاريخية قراءة فقط وليست استلامًا رسميًا أبدًا، مهما كان تحكم المرسل أو اتصاله أو جلسته. المعرّف المربوط لا يُختم له زمن استلام ولا يُقرأ له الزمن الرتيب ولا يُقبل كأمر جديد، ويُعاد قراره المخزّن، والمعرّف نفسه مع أمر مختلف `request_failed INVALID_COMMAND_IDENTITY` لكل الجلسات. الأمر الجديد يُختم عند الدخول قبل أي قراءة من قاعدة البيانات. الكاتب الذي لم يحمّل المباراة لا يختم شيئًا: يبحث بعد التحميل، والأمر الجديد في مباراة تجري ساعتها هنا يُرفض كغير مستلم (`TEMPORARILY_UNAVAILABLE`) ليُعاد إرساله.

### 13.4 Trusted creation / الإنشاء الموثوق

Games with players are created only by the internal `createAssignedGame(gameId, white, black, timeControl)`: both accounts exist, are different, and are active (a verified-email requirement exists as an unused hook, AUTH-EMAIL-VERIFIED-001). The assignment and the live game are created together or not at all as far as any caller can tell: an uncertain outcome is reported `creation_unconfirmed`, never success, and settled later by reconciliation. There is no public game-creation endpoint; matchmaking and challenges will call this use case (GAME-ACCESS-CREATION-API-001).

المقعد من تعيين المباراة الدائم، والتحكم لجلسة واحدة لكل مقعد، وعقد التحكم سرّي على الخادم. الاستلام صريح عبر `claim_game_control` ويُدوّر العقد، والعقد القديم مرفوض من لحظة التدوير حتى لو لم يصل الإشعار. إنهاء الجلسة أو إغلاق الحساب يُسقط التحكم دون استسلام ودون نقله لجلسة أخرى.

## 14. Direct challenges `/challenges` / التحديات المباشرة

Added in Phase 1 Batch 12 (2026-09-29), local and pending review; decisions CHAL-001 to CHAL-015 in changelog section 26. Served by the realtime edge beside `/auth`, only when the edge is configured with authentication. Acceptance was added by Batch 12.1 (section 15).

### 14.1 Request rules / قواعد الطلب

- The session cookie of section 12.1 is the only credential; without a valid session every route is 401 `UNAUTHENTICATED` (a presented cookie is cleared).
- The browser protections of section 12.2 apply unchanged: an allowlisted `Origin` on every non-GET request (403 `ORIGIN_NOT_ALLOWED`), `application/json` on every `POST` (415 `UNSUPPORTED_MEDIA_TYPE`), `Sec-Fetch-Site: cross-site` refused (403), no CORS headers.
- Bodies: strict JSON (duplicate keys and malformed JSON are 400 `INVALID_REQUEST`), at most 1024 bytes (413 `PAYLOAD_TOO_LARGE`), depth 2, strings of at most 64 characters, at most 4 members, no arrays. Unknown members are 400 `INVALID_REQUEST`. No body member names a user id, role, or seat.

### 14.2 Routes / المسارات

| Route | Body or query | Success | Notes |
|---|---|---|---|
| `POST /challenges` | `opponentUsername`, `timeControl {type, initialMs, incrementMs}`, `seatPreference`, optional `rulesetId` | 201 `challenge.v1` | `type` `sudden_death`; `initialMs` 60 000 to 10 800 000, whole seconds; `incrementMs` 0 (LIVE-TIME-INCREMENT-001); `seatPreference` `white`, `black`, or `random`; `rulesetId` from the rules registry, default when omitted. The username is matched case-insensitively |
| `GET /challenges?direction=incoming\|outgoing[&cursor][&limit]` | query only; unknown or repeated parameters are 400 | 200 `challenge_page.v1` | Pending, unexpired challenges only, newest first; `limit` 1 to 50 (default 20); `nextCursor` is opaque and null on the last page |
| `GET /challenges/:challengeId` | none | 200 `challenge.v1` | Participants only; any status |
| `POST /challenges/:challengeId/decline` | exactly `{}` | 200 `challenge.v1` (`declined`) | The challenged player only |
| `POST /challenges/:challengeId/cancel` | exactly `{}` | 200 `challenge.v1` (`cancelled`) | The challenger only |

Any other path or method under `/challenges` is 404 `NOT_FOUND`. `POST /challenges/:challengeId/accept` is section 15.4.

Rules: a challenge expires 24 hours after creation; it can be acted on while the server's UTC time is before `expiresAt` and is expired from `expiresAt` on (`resolvedAt = expiresAt`). One pending challenge per pair of players in either direction; at most 20 outgoing and 100 incoming pending per user. Repeating the same decline or cancel returns the resolved challenge again (200, no change). A non-participant gets 404 `CHALLENGE_NOT_FOUND`, the same as for an unknown id.

### 14.3 Wire formats / صيغ الرسائل

- `challenge.v1`: `{ "format": "challenge.v1", "challenge": { "challengeId", "status", "viewerRole", "challenger": { "username" }, "challenged": { "username" }, "rulesetId", "timeControl": { "type", "initialMs", "incrementMs" }, "seatPreference", "createdAt", "expiresAt", "resolvedAt", "createdGameId" } }`. `challengeId` is 22 base64url characters. `status` is `pending`, `declined`, `cancelled`, `expired` (or `processing` for a reserved acceptance, or `accepted`; section 15). `viewerRole` is `challenger` or `challenged`. Times are UTC epoch milliseconds; `resolvedAt` and `createdGameId` are null when absent. Participants appear by username only: no user id, email, account status, session, lease, or token.
- `challenge_page.v1`: `{ "format": "challenge_page.v1", "direction", "challenges": [ <challenge body> ], "nextCursor" }`.
- `challenge_error.v1`: `{ "format": "challenge_error.v1", "code", "retryAfterMs"? }`. No error carries SQL, SQLSTATE, a table name, a user id, or a stack.

| Status | Codes |
|---|---|
| 400 | `INVALID_REQUEST`, `INVALID_TIME_CONTROL`, `INVALID_SEAT_PREFERENCE`, `INVALID_RULESET`, `CANNOT_CHALLENGE_SELF` |
| 401 | `UNAUTHENTICATED` |
| 403 | `ACCOUNT_UNAVAILABLE` (the caller's account is not active), `NOT_CHALLENGE_PARTICIPANT` (a participant using the other role's action), `ORIGIN_NOT_ALLOWED` |
| 404 | `PLAYER_NOT_FOUND`, `CHALLENGE_NOT_FOUND`, `NOT_FOUND` |
| 409 | `PLAYER_UNAVAILABLE` (opponent not active, or its incoming limit reached), `CHALLENGE_ALREADY_PENDING`, `CHALLENGE_LIMIT_REACHED`, `CHALLENGE_NOT_PENDING`, `CHALLENGE_EXPIRED` |
| 413, 415 | `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` |
| 429 | `RATE_LIMITED` with `retryAfterMs` and `Retry-After` (10 creations at once, then one every 30 s per user, per process) |
| 503 | `TEMPORARILY_UNAVAILABLE` with `Retry-After: 1` |

### 14.4 Storage / التخزين

Table `challenges` (migration `001_challenges`, with its own bookkeeping tables `challenges_schema_migrations` and `challenges_schema_migration_lock`). PostgreSQL enforces every invariant the domain checks: id format, distinct participants, status set, time-control bounds, `increment_ms = 0`, seat preference, `expires_at > created_at`, resolution times per status, `created_game_id` exactly when accepted, one pending row per unordered pair, one challenge per created game. Both user foreign keys are `ON DELETE RESTRICT`. A trigger refuses any update of a resolved row and any change to a pending row other than its resolution.

التحدي بين حسابين نشطين باسم المستخدم، صالح 24 ساعة، ويُرفض أو يُلغى أو تنتهي صلاحيته. غير المشارك يرى 404 كأن التحدي غير موجود. لا يظهر في الرسائل إلا اسم المستخدم. قبول التحدي غير متاح حتى يُحسم وقت بدء ساعة المباراة.

## 15. Game start lifecycle and challenge acceptance / دورة بدء المباراة وقبول التحدي

Added in Phase 1 Batch 12.1 (2026-09-29), local and pending review; decisions GSL-001 to GSL-014 and CHAL-016 to CHAL-022 in changelog section 27. GAME-START-LIFECYCLE-001 is RESOLVED by the owner's decision: an accepted challenge creates a game awaiting its players with no clock running; both players claim control and explicitly declare ready; the game's writer then starts the game atomically, and White's clock runs from that instant.

### 15.1 Lifecycle / دورة الحياة

| `gameLifecycle` | Stored status | Sequence | Clock | A command |
|---|---|---|---|---|
| `awaiting_players` | `awaiting_players {startDeadlineAtWallMs}` | 0 | stopped, full balances | refused `GAME_NOT_STARTED` |
| `in_progress` | `active` | 1 or more | running for the side to move | decided as before |
| `ended` | `finished` or `unresolved` | any | stopped | decided as before |
| `aborted_before_start` | `aborted_before_start {reason: START_DEADLINE_PASSED, startDeadlineAtWallMs}` | 1 | stopped, balances unchanged | refused `GAME_ABORTED_BEFORE_START` |

- The start deadline is UTC wall time: the acceptance time plus 10 minutes, fixed in the challenge reservation and stored in the game. A game can start while `now < startDeadlineAt`; from `startDeadlineAt` on it is aborted.
- The start and the abort are each one compare-and-set commit, sequence 0 to 1, by the game's writer. Each happens at most once, and never both.
- An aborted game has no result, winner, loser, timeout, or rating effect.
- Before the start, a command of any family (SubmitMove, ClaimDraw, ResignGame, OfferDraw, RespondDrawOffer) is refused at the writer's ingress before any clock reading. It gets no receipt time, binding, sequence, or clock effect. A command that reaches the core anyway is rejected `GameNotStarted` (after an abort, `GameAbortedBeforeStart`) with nothing bound.
- After the start, a disconnect never pauses the game.
- A restart before the start is not a recovery pause: the game stays `awaiting_players` in any clock domain, because a stopped clock is never read again. After the start, the existing `RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED` pause applies unchanged.
- Stored as `live_game_state.v2` (migration `004_live_game_lifecycle`). v1 rows keep their meaning, and a v1 record never holds a pre-game status. Command bindings keep their format `live_game_state.v1`.

### 15.2 Ready barrier / حاجز الجاهزية

- Readiness is ephemeral: held by the game's writer only, never stored, at most one mark per seat.
- A mark needs the session and the account active, the seat the player's, and this session holding the seat's control (its stored lease is applied to the writer first). The writer then decides at its turn, on a fresh load: the game still awaiting, the deadline not passed, the lease still the seat's lease, and the connection open.
- A mark counts only while its lease is the seat's lease and its connection is open. It is cleared when the connection closes, when control moves (transfer, logout, revocation, or expiry), and by the start or the abort.
- When both seats hold a valid mark, the writer job that made the second mark starts the game. No readiness or time comes from the client.

### 15.3 Realtime protocol changes (`chess_one.realtime.v1`) / تغييرات البروتوكول

- Client `ready_game {type, requestId, gameId}`. Strict: an unknown field is `UNKNOWN_FIELD`.
- Server `game_ready_state {requestId, gameId, myReady, opponentReady, gameLifecycle}`: the answer to `ready_game` (`in_progress` for the ready that started the game), or a notice with `requestId` null when either seat's mark is made or cleared.
- `game_snapshot.v2` replaces `game_snapshot.v1` (section 11.4). It adds `gameLifecycle`, `startDeadlineAt` (UTC epoch ms, null unless awaiting), `myReady`, `opponentReady` (both false unless awaiting), and `clock.initialMs`. `canClaimControl` is true while control is not held and the game is awaiting or in progress. `status` may be `awaiting_players` or `aborted_before_start`.
- `request_failed` codes: `GAME_NOT_STARTED` and `GAME_ABORTED_BEFORE_START` for a command (never received). For `ready_game`: `CONTROL_NOT_HELD`, `GAME_NOT_AWAITING`, `START_DEADLINE_PASSED`, `SESSION_ENDED`, `GAME_ACCESS_DENIED`, and `TEMPORARILY_UNAVAILABLE`.

### 15.4 `POST /challenges/:challengeId/accept`

- The same session cookie, `Origin`, `Sec-Fetch-Site`, media type, body limits (exactly `{}`), headers, and error hygiene as the other challenge routes. Only the challenged player may accept: the challenger gets 403 `NOT_CHALLENGE_PARTICIPANT`, and anyone else gets 404 `CHALLENGE_NOT_FOUND`.
- 200 `challenge_accept.v1`: `{ "format", "challenge": <challenge body: status accepted, createdGameId, viewerSeat>, "game": { "gameId", "viewerSeat", "lifecycle", "startDeadlineAt" } }`.
- 202 `challenge_accept.v1` with challenge status `processing` and `game: null` while the game's existence is not proven. No game id is shown. A retry continues the same reserved game.
- Repeating an accepted accept returns the same game (200). Refusals: 409 `CHALLENGE_NOT_PENDING`, `CHALLENGE_EXPIRED`, `PLAYER_UNAVAILABLE`, or `CHALLENGE_ACCEPT_FAILED` (Batch 12.2, section 15.6); 503 `TEMPORARILY_UNAVAILABLE`.
- No user id, lease, session id, or database detail is returned. `challenge.v1` gains `viewerSeat` (null unless accepted) and shows a reserved acceptance as status `processing`, and a failed one as `accept_failed` (Batch 12.2).
- Acceptance does not claim either seat: the game begins with no controller.

### 15.5 Acceptance storage (`002_challenge_acceptance`) / تخزين القبول

- Statuses `pending` to `accepting` to `accepted`. `accepting` reserves, once and immutably: `accepted_at`, `intended_game_id` (a 128-bit CSPRNG id), `white_user_id` and `black_user_id` (a `random` preference is drawn once with `node:crypto`), and `start_deadline_at = accepted_at + 10 minutes`.
- `accepted` requires `created_game_id = intended_game_id`, written only after the game is proven to exist, and `resolved_at = accepted_at`. An accepting challenge never expires and cannot be declined or cancelled.
- A trigger refuses `pending` straight to `accepted`, any change out of `accepting` other than to `accepted`, and any change of the reservation. A unique index allows one acceptance per game id.

### 15.6 Acceptance recovery (`003_challenge_accept_failed`, Batch 12.2) / استعادة القبول

- `accepting` ends as `accepted` or `accept_failed`. `accept_failed` is final: it keeps the whole reservation, has no created game, and `resolved_at >= accepted_at` (possibly after `expires_at`). It is never `declined`, `cancelled`, or `expired`.
- An accept on an `accepting` challenge settles the same reservation (the same game id and seats, never new ones): 200 with the same game, 202 `processing`, or 409 `CHALLENGE_ACCEPT_FAILED`. An accept on an `accept_failed` challenge answers 409 `CHALLENGE_ACCEPT_FAILED` again; decline and cancel answer 409 `CHALLENGE_NOT_PENDING`. The body never names the cause (disabled, locked, a mismatched game, or any store detail).
- `accept_failed` is reached only on proof: an account lost (or no longer eligible) before the game exists, or a stored game that differs from the reservation. An unknown game, an unreadable account, or a failed write stays `accepting`; no challenge fails for its age.
- Trusted maintenance, not an HTTP route: `reconcileAcceptingChallenges(limit, after)`, limit 1 to 100, order `(accepted_at, challenge_id)` ascending, result `{ listed, examined, accepted, failed, processing, next }`.
- Storage: `accept_failed` in the status, resolution, and reservation checks; the partial index `challenges_accepting_order`; the guard trigger allows `accepting` to `accepting`, `accepted`, or `accept_failed` only. A failed acceptance keeps its unique reserved game id even when a foreign game holds that id.

ينتهي القبول المحجوز إما مقبولًا أو فاشلًا نهائيًا (`accept_failed`) مع بقاء الحجز كما هو، ولا يرى العميل إلا الرمز العام `CHALLENGE_ACCEPT_FAILED`. عدم اليقين يُبقي التحدي قيد القبول وقابلًا للإعادة.

قبول التحدي يحجز أولًا (معرّف المباراة والمقاعد والمهلة ثابتة)، ثم تُنشأ المباراة بانتظار اللاعبين دون أي ساعة، ولا يصبح التحدي مقبولًا إلا بعد إثبات وجود المباراة. يستلم كل لاعب التحكم ويعلن جاهزيته صراحة، فيبدأ كاتب المباراة اللعب مرة واحدة وتبدأ ساعة الأبيض. إن لم يجهز اللاعبان قبل انقضاء عشر دقائق تُلغى المباراة دون نتيجة.
