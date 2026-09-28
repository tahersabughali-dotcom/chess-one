# Domain Data Ownership Matrix / مصفوفة ملكية بيانات المجالات

**Status / الحالة:** Normative annex of Chess One spec v5.  
**Rule / القاعدة (DEC-048):** المجال لا يعدّل مباشرة جداول الحقيقة لمجال آخر. البنية المشتركة لا تعني ملكية مشتركة.  
**Retention / الاحتفاظ:** حيث لا توجد سياسة ولاية قضائية، التصنيف الخصوصي مذكور والحفظ الزمني H بسبب MIS-015. لا تُخترع مدة.

القراءة المسموحة تعني قراءة عبر عقد أو إسقاط مشتق، لا كتابة في جدول المالك.

## 1. Resolved critical entities / الكيانات الحرجة المحسومة

الحالة A هنا تعني أن ملكية الكتابة حُسمت كعقد معماري مبني على خريطة الوحدات المعتمدة وقرارات v5. ليست اعتمادًا لخوارزمية أو لمزود.

| Entity | Owning Domain | Authoritative Writer | Allowed Readers | Forbidden Direct Writers | Created By | Updated By | Published Events | Consumed Events | Retention / Privacy | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| Account | MOD-001 Identity | Identity service | Profile, Admin audit view, Edge auth | Game, Rating, Economy, AI, Analysis | Registration / guest claim flow | Identity only | `account.created.v1` | `guest.claimed.v1` as a command result inside Identity | Personal. Retention H | A |
| Session | MOD-001 Identity | Identity service | Edge auth, Live Game lease check (token facts only) | Game state writer, Economy, AI | Login / guest session | Identity (rotate, revoke) | session.revoked internal | — | Secret. Short-lived. Duration H | A |
| Device | MOD-001 Identity | Identity service | Account owner, security audit | Game, Economy, AI | Account owner | Identity | — | — | Personal device prefs. Retention H | A |
| GuestIdentity | MOD-001 Identity | Identity service | Live Game (id only), Claim flow | Rating, Economy, Career writer, AI | Guest play / guest challenge | Identity | `guest.claimed.v1` after successful claim | — | Temporary personal. Claim proof method H. Retention H | A |
| PlayerProfile | MOD-001 Identity / Passport | Identity/Profile | Search projection if privacy allows, owner, permitted friends | Game, Rating writer, Economy, AI | Identity | Profile owner via Identity | `privacy.updated.v1` when visibility changes | `rating.updated.v1` as read-model input only if a profile projection is explicitly contracted | Field-level visibility. Public/friends/self | A |
| PrivacySettings | MOD-001 Identity | Identity service | Authorization layer, Search filter, AI permission check | All other domains | Identity | Account owner / guardian where policy exists | `privacy.updated.v1` | — | Private. Child policy H | A |
| Game | MOD-002 Live Game Authority | Live Game Authority | Players, Tournament read, History read, Analysis after finish | AI, Economy, Chess Land, Rating, Clients | Matchmaking or explicit create command | Live Game Authority | `game.created.v1`, `game.started.v1` | `match.paired` command | Game record. Spectator visibility by policy | A |
| Move | MOD-002 Live Game Authority | Live Game Authority | Players, History, Analysis after the move is committed; spectators per delay policy | Clients, AI, Economy | Accepted `SubmitMoveCommand.v1` | Not rewritten. Corrections are new audited facts, not silent edits | `game.move_accepted.v1` after commit | — | Part of game record | A |
| ClockState | MOD-002 Live Game Authority | Live Game Authority | Players via snapshot, Reconnect | Clients, Analysis, AI | Game start | Live Game Authority from server time | Included in snapshots and finish event | — | Operational, tied to game | A |
| GameResult | MOD-002 Live Game Authority | Live Game Authority | Rating, Tournament, History, Career projection | Clients, AI, Economy, Analysis | Result finalization inside the critical commit | Live Game Authority only. Fair-play restitution is a later audited command, not a silent table edit | `game.finished.v1` | — | Official result. No client overwrite | A |
| ReconnectToken | MOD-002 Live Game Authority | Live Game Authority | Reconnecting session after auth | Logs in clear text, AI, Economy | Game start / refresh | Live Game Authority (rotate) | — | — | Secret, short-lived. Retention H | A |
| MatchmakingEntry | MOD-003 Matchmaking | Matchmaking | The queued player, operations metrics | Live Game rules, Economy, AI | Queue join | Matchmaking | `match.requested`, `match.paired` | Rating read snapshot | Private operational | A |
| RatingState | MOD-003 Rating | Rating service | Profile projection, Matchmaking, Leaderboard if allowed | Live Game Authority, AI, Economy, Clients | Rating service | Rating service from `game.finished.v1` | `rating.updated.v1` | `game.finished.v1` | Personal. Algorithm H. Official rating only | A |
| RatingHistory | MOD-003 Rating | Rating service | Owner, audit, profile if allowed | Live Game, AI, Clients | Rating service | Append-only by Rating | `rating.updated.v1` | `game.finished.v1` | Personal ledger of rating. Append-only | A |
| Tournament | MOD-004 Competition | Tournament service | Entrants, public catalog per visibility | Live Game rules writer, Economy direct | Organizer command | Organizer/Arbiter via Tournament commands | `tournament.registered`, `tournament.finished` | — | Event data. Mixed public | A |
| Pairing | MOD-004 Competition (tournament pairing) | Tournament service | Players in the event, arbiters | Matchmaking queue, Clients | Pairing run | Arbiter audited correction | `tournament.round_published` | Official `game.finished.v1` for standings | Event operational | A |
| AnalysisJob | MOD-005 Analysis | Analysis service | Job owner, operations | Live Game Authority, AI as writer | Analysis request after game finish or import | Analysis workers via Analysis service | `analysis.requested` | `game.finished.v1`, `imported_game.validated` | Private job. Not on move path | A |
| AnalysisResult | MOD-005 Analysis | Analysis service | Owner, Professor/AI if permitted and game is not an active competitive restriction | Live Game result writer, Clients as authority | Analysis service | Analysis service; abstention is a result state | `analysis.completed` | Engine worker output inside Analysis | Private. Provenance required. Formulas for public scores H | A |
| ChessMindEvidence | MOD-006 Player Intelligence | Mind evidence pipeline | Owner, permitted coach, AI only with grant | Live Game, Rating, Economy | Pipeline from validated events | Mind pipeline | `mind.evidence.created` | Finished-game and training events | Private by default. Sensitive. No IQ/medical claim | A |
| LearningPlan | MOD-006 Learning | Learning service | Owner, permitted coach | Live Game, Economy, AI direct write | Owner or planner command | Learning service | `mind.profile.updated` consumers may read; plan updates are learning events | Permitted mind profile | Private | A |
| Wallet | MOD-012 Economy | Economy ledger projection | Account owner | Live Game, AI, Chess Land, Clients | Economy | Derived from ledger only | balance is derived, not an event source of truth | `ledger.posted` | Financial private. Constants TBD | A |
| LedgerEntry | MOD-012 Economy | Economy | Owner, audit, reward integrity | Live Game, AI, Clients, Chess Land | Economy after verified reward or payment contract | Append-only. Reversal is a new entry | `ledger.posted` | `reward.verified`, billing events | Financial. Append-only. Idempotent | A |
| Reward | MOD-012 Economy with Integrity gate | Economy creates pending; Integrity verifies | Owner, integrity reviewers | Live Game direct, AI | Eligible domain event | Integrity / Economy via contract | `reward.pending`, `reward.verified` | `game.finished.v1` and other eligible events | Financial. Farming rules separate from chess cheating | A |
| Entitlement | MOD-012 Commerce | Commerce | Owner, client presentation | Live Game, AI | Completed order contract | Commerce (grant/revoke via refund contract) | entitlement.changed | `order.completed`, `payment.refunded` | Ownership of cosmetics. No chess power | A |
| StoreOrder | MOD-012 Commerce | Commerce | Owner, billing audit | Live Game, AI, Chess Land | Checkout command | Commerce | `order.completed` | Payment provider result via billing contract | Commercial. Provider H | A |
| Payment | MOD-012 Billing boundary inside Commerce | Billing | Billing audit, owner receipt view | Game, Rating, AI, Wallet direct edit | Billing | Billing from signed provider notices | `payment.refunded` and payment status events | Provider webhook contract | Financial. PCI scope minimized. Provider H. Raw card data is not a Chess One entity | A |
| FairPlayCase | MOD-015 Trust | Trust service | Assigned reviewers, audit | AI as final writer, Live Game silent edit, Economy | Report or signal intake | Reviewers via Trust commands | `fairplay.case.updated` | Game signals as events, not table writes | Sensitive. Appeal policy H | A |
| AuditEvent | MOD-015 Security audit boundary | Audit append service | Security reviewers, break-glass with its own audit | Ordinary domain admins, AI, the actor who is the subject | Emitting domain via audit contract | Nobody updates or deletes in place | audit.recorded | Security-relevant commands | Restricted. Append-only. Storage tech TBD. DEC-054 | A |
| FeatureFlag | MOD-016 Admin | Admin via audited flag command | All services through a snapshot, not through Admin's tables | Live Game move path as a remote call, AI | Admin | Admin | `feature.disabled.v1` | — | Operational. Safe default in DEC-053 | A |

### Writer notes / ملاحظات الكتابة

- Live Game Authority يقرأ من الهوية حقائق العقد: هل الجلسة صالحة وهل عقد التحكم ساري. لا يقرأ ولا يكتب جداول الملف أو الخصوصية التفصيلية.
- Rating يقرأ `game.finished.v1` ولا يفتح معاملة المباراة.
- Wallet رقم مشتق من الدفتر. تعديل الرصيد مباشرة ممنوع.
- Payment لا يكتب في دفتر مكافآت اللعب إلا بحدث محاسبي صريح بعد نجاح موثّق.
- Analysis وAI لا يستدعيان أمرًا يغير `GameResult`.
- `ClaimDrawCommand.v1` و`OfferDrawCommand.v1` و`RespondDrawOfferCommand.v1` و`ResignGameCommand.v1` أوامر داخل Live Game Authority. لا كيان جديد، ولا كتابة في التصنيف أو الدفتر.

## 2. Ambiguous entities — engineering recommendation only / كيانات ملتبسة — توصية هندسية فقط

هذه ليست قرارات مالك. الحالة H. التنفيذ لا يجمّد جدولًا لها قبل الحسم.

| Entity | Recommendation | Why it is not closed | Status |
|---|---|---|---|
| Certificate | Learning/Credentials owns the certificate record. Identity Passport displays it through a read contract. Trust may change status only by an audited Trust command that Credentials applies. | Certificate rules, levels, and revocation policy are MIS-013 / Q-13. | H |
| CareerEvent | Career projection inside MOD-001 appends its own events after consuming other domains' events. Source domains do not write the career table. | Which events are "career" versus private history is not fully listed. | H |
| PieceMastery | Collectibles (MOD-012) owns visual/mastery unlock state. Learning may supply evidence events. It must not grant rating or chess power. | Economy numbers and unlock formulas are TBD. UC-EC-08 is still C. | H |
| Position | No global Position table with one writer. A position is a value inside the owning aggregate: Game owns positions in a game; Analysis owns positions in an analysis. | A shared mutable Position row would recreate cross-domain writes. | H |
| SpectatorSession | Watch (MOD-013) owns the spectator session and reads committed game snapshots. Live Game does not write spectator rows on the move-accept path. | Spectator product scope is UC-GM-08 = C. Delay/leakage policy is in the threat model but the product switch is not an MVP decision. | H |
| ChronicleEntry | Split by chronicle type. Chess Land village/world chronicle: MOD-010. Personal returner summary: a Career/Profile projection. Neither writes the other's table. | UC-CL records are F. Returner Chronicle UC-PL-03 is A as a product idea, but its data owner was not explicit. | H |

## 3. Cross-domain command examples / أمثلة أوامر عابرة

| Intent | Allowed shape | Forbidden shape |
|---|---|---|
| Finish a rated game and change rating | Live Game commits result and emits `game.finished.v1`. Rating consumes it. | Live Game `UPDATE rating_state` |
| Grant a reward | Economy creates pending reward from the event. Integrity posts ledger. | Analysis inserts a ledger row |
| Explain a game | AI reads a permitted analysis result. | AI updates `game_result` or `wallet` |
| Disable a feature | Admin emits `feature.disabled.v1`. Services use a snapshot. | Move handler queries Admin tables synchronously |
