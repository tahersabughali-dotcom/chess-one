# Security Threat Model v1 / نموذج التهديدات الأمني — الإصدار 1

**Level / المستوى:** Design threat model for Chess One v5. No vendors, no products, no secrets.  
**Binding / الإلزام:** DEC-047, DEC-048, DEC-054, and the security principles already marked A.  
**Clients are untrusted / العملاء غير موثوقين.** المنع الحساس على الخادم.

كل سطر: التهديد → الأصل → الحد → المنع → الكشف → الاستجابة.

## 1. Web and session / الويب والجلسة

| Threat | Asset | Boundary | Prevent | Detect | Respond |
|---|---|---|---|---|---|
| Session theft | Session secret, control lease | Browser storage and transport | Session secret only over authenticated transport. Not in URLs or analysis prompts. Http-only session where the client platform allows. Short lease separate from long login | New device/lease audit. Unexpected lease rotation | Revoke session and leases. Force resync. AuditEvent |
| XSS | Session, move UI, privacy | Web rendering | No authoritative HTML from players in the game shell. Encode text. Separate game document from untrusted content pages | Client error and content reports | Disable affected content feature. Do not disable Tier 0 because a content page is hostile |
| CSRF where cookie auth is used | State-changing commands | Edge | State-changing calls require a secret the foreign site cannot read, or a non-cookie credential. Safe methods stay read-only | Rejected cross-site posts | Fail closed. Audit repeated failures |
| WebSocket origin / authentication | Live game channel | Realtime edge | Accept upgrade only from allowed origins and an authenticated game session. Bind the socket to game_id and lease | Connections from unexpected origins | Drop socket. Clock and state stay server-side |
| Session fixation | New session | Identity | Issue a new session id after authentication. Do not accept a caller-chosen session id | Reuse of pre-login id | Reject and audit |

## 2. Commands / الأوامر

| Threat | Asset | Boundary | Prevent | Detect | Respond |
|---|---|---|---|---|---|
| Replay / duplicate move | Game sequence, clock | SubmitMoveCommand.v1 | Idempotency on client_command_id. Same semantic payload replays the stored binding decision with `replayed_response`. A different payload is `InvalidCommandIdentity` and does not execute. Sequence check. Client `actor_id` cannot assign a seat | Duplicate and identity-mismatch rate | Return the original decision unchanged. No second move |
| Stale command | Canonical state | Live Game | StaleSequence rejects without write | Count of stale commands per game | Client must resync. No client overwrite |
| API abuse / flooding | Edge, clock fairness | Edge and game entry | Rate limit per session, game, and IP class. Move path limit is separate from search/analysis limit | Spike in rejects | Throttle the caller. Do not stall other games |
| Privilege escalation | Admin, arbiter, wallet | Every command | Authorization on the server for the action, not the UI role label. AI tools have an allow-list | Denied-admin and denied-agent events | Fail closed. Audit |
| Two devices moving | One controller rule | Control lease | One active lease. Old lease fails Unauthorized | Takeover and rejected old-lease commands | Audit takeover. Resync both devices |

## 3. Admin, services, secrets / الإدارة والخدمات والأسرار

| Threat | Asset | Boundary | Prevent | Detect | Respond |
|---|---|---|---|---|---|
| Admin account compromise | Flags, moderation, audit | Admin entry | MFA for admins. Least privilege. No shared admin login. Break-glass is its own audited path | New admin device, flag flips, export spikes | Revoke admin session. Freeze sensitive actions. Incident record |
| Service-to-service impersonation | Game result, ledger | Internal commands | Each caller has an identity. Live Game accepts result-changing commands only from its own authority. Analysis identity cannot call result mutation | Calls with the wrong caller id | Deny and audit. Do not store the foreign write |
| Secret in a client or repository | Provider keys, session signing | Build and repo | No server secret in Web, desktop, or mobile clients. No production secret in the spec repo | Static scan gate before any future code | Rotate the secret. The rotation procedure is operational and still vendor-TBD |
| Audit-log tampering | AuditEvent | Security audit boundary | Append-only. Ordinary domain admins cannot delete or edit their own sensitive audit rows. Corrections are new events | Gap in sequence or missing emitter | Treat gap as an incident. Do not rebuild history from an admin's memory |

تقنية تخزين التدقيق TBD (DEC-054). الصفة المفاهيمية المطلوبة: إلحاق، وكشف فجوة، ومنع المسح الصامت.

## 4. Uploads, payments, guests, children / الرفع والمدفوعات والضيف والأطفال

| Threat | Asset | Boundary | Prevent | Detect | Respond |
|---|---|---|---|---|---|
| Upload attack | Production app, scanners, PGN import | Upload boundary | Untrusted file never executes inside the game service. Allow-list of types. Separate inspection from production logic. User confirms a scanned position before it becomes a FEN | Rejected type, malware signal from the inspector | Quarantine. Feature degrades. Live games continue |
| Payment / webhook attack | Orders, entitlements, ledger | Billing boundary | Signed provider notice, idempotency key, amount/currency check. Game service does not accept payment callbacks | Duplicate or unsigned notices | Ignore unsigned notices. Ledger repair is a new entry. Provider remains H |
| Guest history claim | Guest games, future account | Identity | Claim is a capability, but proof_method is H and must fail closed until the owner pins a method. No claim attaches history without a verified proof | Repeated claim attempts | Deny. Do not merge histories |
| Child safety | Child account, chat, purchases, mind profile | Identity and Trust | Social/UGC/purchases for minors stay shut until MIS-008 is decided. Defaults are restrictive where a child flag exists. Chess Mind stays private | Reports, guardian policy gaps | Fail closed on chat, purchase, and mind export. This does not invent an age number |

## 5. Competitive integrity and spectators / النزاهة التنافسية والمشاهدون

| Threat | Asset | Boundary | Prevent | Detect | Respond |
|---|---|---|---|---|---|
| Engine/AI help inside Chess One during a rated game | Fair game, move choice | Every Chess One API, screen, tab, tool, and internal agent | DEC-047. Server checks: account is seated in an active competitive game, and the requested position is in that game's tree. If so, deny evaluation, best move, opening explorer, tablebase, and coach line. UI hiding is not the control | Denied-assist events. Attempts from another route | Deny. Audit. Do not ban from a single event without the fair-play case path |
| Powerful engine shipped in the competitive Web client | Same | Client packaging | Rules library may ship. A search/analysis engine that can evaluate the live game must not ship inside the competitive client if it creates an internal cheating path | Package review gate | Block that packaging. Analysis stays on isolated workers after the game, or outside competitive sessions |
| External engine on the user's machine | Fair play | Outside Chess One's process | Chess One does not claim it can prevent foreign software. Detection is a Trust signal plus human review, not a move-path dependency | Fair-play signals | Open a case. Do not let detection calls block the clock |
| Spectator leakage | Hidden eval, delayed position | Watch versus player channel | Spectator fanout is a different stream. Engine eval is not part of `game.move_accepted.v1`. Broadcast delay policy must be explicit before competitive broadcast is enabled. UC-GM-08 is still C, so broadcast is not opened by this model | Eval fields on a player socket | Strip the field. Incident if a player received it |
| Prompt bypass | Coach during a live game | AI orchestrator | Deny from game-state permissions before the model sees the position. Rephrasing does not matter | Policy denials | Same as engine help |

## 6. Data and ownership abuse / إساءة البيانات والملكية

| Threat | Asset | Boundary | Prevent | Detect | Respond |
|---|---|---|---|---|---|
| Cross-domain table write | Rating, wallet, result | Storage credentials | Each writer's credential can change only its tables. Shared database, if ever chosen, still uses separate rights. DEC-048 | Writes by the wrong identity | Reject. Audit. No production schema is created in this batch |
| Search index leak | Private games, mind data | Search projection | Index only fields the privacy contract marks searchable. Filter failure fails closed | Private id in a public result test | Rebuild index. Disable search |
| AI reading too much | Mind, messages, children | Agent permission | Allow-list per agent. No direct database credentials for agents | Tool calls outside scope | Deny tool. Auditor reviews. Agent cannot approve itself |

## 7. What this model refuses to pretend / ما لا يدّعيه النموذج

- لا يمنع برنامج محرك خارج المتصفح أو خارج التطبيق.
- لا يختار مزود حماية أو مزود دفع أو مخزن أسرار.
- لا يثبّت عمر الطفل أو مدة الجلسة بالأيام. المدة H حيث لم تُقرر.
- لا يفتح المجتمع أو المحتوى أو مشتريات القاصرين قبل MIS-008.
- وضع الأمان التنافسي خادمي حتى لو أخفت الواجهة الزر.

## 8. Development gates / بوابات البناء

DEC-055. التفاصيل في دستور الهندسة. الملخص: تهديد قبل الميزة المكشوفة، ملف جلسة آمن حيث يُستخدم، تخطيط CSP وTrusted Types، أصل الاتصال اللحظي، تفويض خادمي، تحديد معدل، فحص أسرار، فحص ثغرات، SBOM قبل الإنتاج، لا سر في المستودع أو العميل، صلاحية قاعدة لكل مجال، تدقيق إلحقي، تحقق من شكل المدخل، عزل الرفع، ولا اعتماد قاعدة لوكيل ذكي. لا خدمة اختيارية بعيدة توقف الطبقة 0 بشكل متزامن.

## 9. Minimum security tests / أدنى اختبارات أمن

مرتبطة بـ `TEST_ARCHITECTURE_AND_GATES_V1.md` عائلة TST-SECURITY:

- نقلة بلا عقد تحكم، وبعقد ملغى، وبتسلسل قديم، وبمعرّف أمر مكرر.
- طلب تحليل لموقف من مباراة مصنفة نشطة من مسار غير شاشة اللعب.
- ضيف يطالب بتاريخ بلا إثبات معتمد.
- مسؤول يحاول حذف AuditEvent.
- هوية تحليل تحاول كتابة GameResult.
- اتصال لحظي من أصل غير مسموح.
- إشعار دفع بلا توقيع، عند وجود حد الفوترة لاحقًا. حتى ذلك الحين الاختبار عقدي على الشكل فقط.
