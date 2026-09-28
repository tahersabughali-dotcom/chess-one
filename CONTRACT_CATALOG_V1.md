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
| GameAlreadyFinished | Result already committed and this command is not the stored accept | No |
| InvalidState | Unusable shape, including a promotion field that the position does not require, or a missing promotion on a promotion move | No, until a binding decision is stored for a well-formed command |
| InvalidCommandIdentity | Same `client_command_id` already has a binding decision, and the semantic payload differs | No execution |

`replayed_response` حقل في كل رد. قيمته `true` فقط عند إعادة قرار مُلزِم مخزّن دون تنفيذ جديد. الرد الأول يحمل `false`. إعادة `Accepted` تبقى `Accepted` مع `replayed_response = true`. لا تُستبدل بنتيجة توحي أن النقلة رُفضت.

### 2.6 Idempotency and stale behavior / التكرار والتسلسل القديم

البصمة الدلالية للأمر هي: `game_id` + `from_square` + `to_square` + `promotion_piece` بعد تطبيع الحالة والفراغ.  
خارج البصمة: `client_observed_at` و`client_san` و`actor_id` و`expected_game_sequence` و`session_id` و`control_lease_id`.

قرار مُلزِم هو: `Accepted` أو `IllegalMove` أو `NotYourTurn` أو `GameAlreadyFinished` أو `InvalidState` على أمر مكتمل الشكل وصل إلى حكم.  
`StaleSequence` و`Unauthorized` لا يقفلان المعرّف، لأنهما لا يحسمان النقلة ولا يكتبان حالة.

- بعد قرار مُلزِم، نفس المعرّف مع نفس البصمة: أعد القرار الأصلي مع `replayed_response = true`. لا نقلة ثانية. `Accepted` يبقى `Accepted` حتى لو تغيّر التسلسل الذي يرسله العميل في إعادة المحاولة، وحتى لو انتهت المباراة بعد تلك النقلة.
- بعد قرار مُلزِم، نفس المعرّف مع بصمة مختلفة: `InvalidCommandIdentity` ولا تنفيذ.
- معرّف لم يُقفل بعد، وتسلسل قديم: `StaleSequence` بلا كتابة. إعادة نفس المعرّف بعد المزامنة ما زالت ممكنة.
- طلبان متطابقان يصلان معًا: الكاتب الواحد يسلسلهما. الأول يُنتج القرار المُلزِم، والثاني يستلمه كإعادة.
- المعرّف خاص بالمباراة وبالمقعد الذي قُفل عليه. مستدعٍ ليس ذلك المقعد لا يستلم جسم القرار الأصلي؛ الرد `Unauthorized`.
- أمر لم يُقبل من قبل، والمباراة منتهية: `GameAlreadyFinished`.

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

هذه أوامر توثيق فقط. لا تنفيذ في هذه الدفعة. كلها أوامر سلطة المباراة الحية. العميل لا يرسل نتيجة، ولا FEN، ولا SAN كسلطة.

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
