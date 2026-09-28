# Failure Domain and Degradation Matrix / مصفوفة مجالات الفشل والتدهور

**Principle / المبدأ:** أصغر عطل يبقى أصغر عطل. زر واحد في لوحة المفاتيح لا يوقف بقية الأزرار.  
**Binding / الإلزام:** DEC-045, DEC-046, DEC-053, BR isolation rules in spec v5.

## 1. Process boundaries / حدود العمليات

| Boundary | Owns | Must not own |
|---|---|---|
| Chess Rules Library | Deterministic legality, resulting position, rule-based terminal checks for the game's `ruleset_id`. Current baseline `FIDE-E01-2023`. Side-effect free as far as practical | Clock authority, accounts, ratings, network, engine search |
| Authoritative Live Game Service | Live state, command order, clocks, results, reconnect sequence, durable active-game record | Bot search, analysis jobs, payments, chat, feature-flag remote calls on the move path |
| Engine / Bot Worker | Search/evaluation for bot games and, separately, analysis jobs | Human-vs-human move acceptance |

تعطل عامل المحرك يوقف مباراة إنسان-ضد-روبوت التي تنتظره، ولا يوقف مباريات البشر. التحليل طابور مستقل عن الروبوت حتى لا يبتلع حمل المراجعة مباريات التدريب الآلي أو العكس. يمكن مشاركة مكتبة القواعد كشفرة نقية. لا تُشارك عملية التشغيل.

## 2. Tier matrix / مصفوفة الطبقات

### Tier 0 — Critical live chess / الشطرنج الحي الحرج

قبول أمر النقلة، الشرعية، الحالة المرجعية الحية، الساعة المرجعية، تسلسل الأوامر والأحداث، حسم النتيجة، حفظ المباراة النشطة واستعادتها.

### Tier 1 — Important platform services / خدمات المنصة المهمة

الهوية والجلسة اللازمة لبدء مباراة مصادَق عليها، إنشاء المباراة، المطابقة، التصنيف بعد المباراة، سجل المباريات.

مباراة نشطة سليمة لا تعتمد تزامنيًا على عمل طبقة 1 غير لازم. التحقق من عقد التحكم يستخدم حقائق جلسة قصيرة العمر موجودة أصلًا مع المباراة، لا طلبًا جديدًا يكتب في ملف اللاعب.

### Tier 2 — Degradable / قابل للتدهور

التحليل، الذكاء الاصطناعي، التدريب، الشهادات، Chess Land، الاقتصاد والمتجر، المجتمع، الدردشة، صنّاع المحتوى، البحث، الإشعارات، الإحصاء، إثراء المشاهدة.

## 3. Failure map / خريطة الفشل

| Domain | Failure | Blast radius | Required isolation | Fallback / degraded mode | Can the live human game continue? | Recovery |
|---|---|---|---|---|---|---|
| Web component | One widget throws | That component | Error boundary around the component | Hide or replace that widget. Board, clock, move list, connection state stay | Yes | Retry widget. Resync if it showed state |
| Web feature | Optional feature crashes (chat, coach, store panel) | That feature | Feature boundary | Feature shows disabled. Game shell remains | Yes | Feature flag or reload of that feature only |
| Web page | A non-game route crashes | That route | Route/page boundary | Other routes and an in-progress game view remain reachable | Yes, if the game route itself is healthy | Navigate back. Game resyncs from server |
| Web client | Whole web app is down | Web users | Client isolation | Other clients and server truth remain. Clock still runs for connected server games | Server game continues. This browser cannot act until it returns, then resync | Reload, resync, lease check |
| API / edge | Edge for a non-game API fails | That API family | Separate entry from the live-game command entry where practical | Game command entry stays up. Optional APIs fail closed | Yes for games already attached to a healthy game entry | Retry, health/readiness split |
| Authoritative live game process | Process or its store is unavailable | Games hosted on that writer | One writer per game. No second writer applying moves | Clients see inability to accept moves. They must not invent a local official result | No new moves are official until the writer recovers. Clock policy remains server-side when the writer is alive | Restore durable state, resync by sequence. Failover must not double-apply a move |
| Engine workers | Worker crash or saturation | Bot moves and analysis jobs using that pool | Separate process and queue from human move acceptance | Human games ignore the worker. Bot game waits or ends that bot session as a bot-game failure, not as a human-game failure | Human vs human: yes | Bounded retry, dead letter, scale workers later |
| Realtime transport | Socket drop | Delivery to that client | Transport is not the rules engine | Enter TransportInterrupted. Clock continues | Yes on the server | Reconnect state machine |
| Event transport | Bus unavailable after commit | Async consumers | Outbox in the source boundary | Result stays committed. Consumers lag | Yes | Retry bounded, dead letter, replay |
| Analysis | Queue stuck or engine disagreement | Reviews and public scores | Queue plus abstention | Review shows unavailable or uncertain. No fake score | Yes | Retry job, abstain, do not write GameResult |
| AI | Provider timeout or unsafe request | Explanations and agents | Permission check before tools. No move-path call | Assistant unavailable. Competitive help denied | Yes | Fail closed on chess help. Audit the denial |
| Store / economy | Checkout or ledger consumer down | Purchases and rewards | No call from move commit | Play continues. Reward stays pending or delayed. Paid entitlement waits for its own completion path | Yes | Idempotent ledger repair. No double reward |
| Chess Land | World service down | World map and progression | Consumes events only | World shows unavailable. Chess play remains | Yes | Replay world projection later |
| Notifications | Channel outage | Toasts, mail, push | Queue | Game does not wait for a notification | Yes | Retry bounded, drop or dead-letter non-critical notices |
| Search | Index stale or down | Search results | Derived index, rebuildable | Search disabled. Source domains remain | Yes | Rebuild from events. Never treat the index as truth |
| Observability | Metrics pipeline down | Operator visibility | Telemetry is off the accept path | Game does not call the metrics system synchronously | Yes | Buffer or drop telemetry. Do not block commits |
| Feature flags | Flag service down | Fresh flag reads | Local snapshot. Move path does not call out | Last snapshot. If none: core chess on, optional features hidden | Yes | Refresh snapshot asynchronously |
| Identity for new login | Login service down | New sessions and new game creation | Existing leases already issued | New login fails. Existing live games keep their leases | Existing games: yes | Restore identity. Do not revoke leases merely because login is down |
| Matchmaking | Queue down | New pairing | Not on the move path | Players cannot start a new matched game. Current games continue | Yes for games already created | Retry join. No partial pair without a created game id |
| Rating consumer | Rating worker down | Displayed rating updates | Outbox consumer | Official result exists. Rating badge may be stale | Yes | Replay `game.finished.v1` idempotently |
| Spectators | Fanout storm or delay | Spectator experience | Async fanout after commit | Players still receive their accept response. Spectators lag or disconnect | Yes | Resync spectators from snapshot. Do not leak engine eval |

## 4. Tier 2 degradation behavior / سلوك التدهور لكل مجال طبقة 2

| Domain | What the user sees | What must keep working | What must not happen |
|---|---|---|---|
| Analysis | Review pending, failed, or abstained | Live moves and clock | A move waits for an evaluation |
| AI | Assistant unavailable; competitive help denied | Live game and rules | An agent writes rating, wallet, or result |
| Training | Plan or puzzle entry unavailable | Live game | Mastery writes a game result |
| Certificates | Certificate view unavailable | Live game and learning evidence already stored | A certificate changes a rating |
| Chess Land | World unavailable | Live game | World service pauses a clock |
| Economy / store | Store or reward delayed | Live game | A payment webhook edits a live game |
| Social | Friends/clans unavailable | Live game | A clan war process is inside move acceptance |
| Chat | Chat closed | Board and clock | Chat transport shares the move-accept thread pool |
| Creator | Recording/publish unavailable | Live game | Recording consent failure aborts a rated game |
| Search | Search unavailable | Source records | Private rows appear because the filter service failed open |
| Notifications | Alerts delayed or dropped | The underlying fact (result, message stored in its domain) | Game commit waits for push |
| Statistics | Dashboards stale | Official result | Stats recompute overwrites GameResult |
| Spectator enrichment | Plain or delayed view | Player channel | Broadcast eval reaches a participant in the live game |

## 5. Single-writer rule / قاعدة الكاتب الواحد

لكل مباراة حية كاتب مرجعي واحد في لحظة واحدة. انتقال الكاتب عند التعافي يجب أن يكمل من آخر تسلسل ملتزم، لا من حالة عميل، ولا من عامل محرك. انقسام كاتبين على المباراة نفسها فشل حرج ويجب أن يُمنع في التصميم قبل تشغيل أكثر من نسخة. آلية المنع تبقى غير مختارة.

## 6. Health versus readiness / الصحة والجاهزية

- الصحة: العملية تعمل.
- الجاهزية لمسار النقلة: مخزن المباراة النشطة قابل للقراءة والكتابة، ومكتبة القواعد محمّلة، ولقطة الأعلام موجودة أو الافتراض الآمن مفعّل.
- جاهزية التحليل أو الذكاء أو المتجر لا تدخل جاهزية مسار النقلة.
