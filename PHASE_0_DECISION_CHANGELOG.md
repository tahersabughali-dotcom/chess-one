# PHASE 0 — Decision Changelog / سجل تغيير القرارات — المرحلة 0

**Spec / المواصفة:** `CHESS_ONE_FINAL_PROGRAMMING_SPEC_BILINGUAL_v5_WEB_FIRST_HARDENED.md`  
**Baseline / الخط السابق:** `CHESS_ONE_FINAL_PROGRAMMING_SPEC_BILINGUAL_v4_WEB_FIRST.md`  
**Batch status / حالة الدفعة:** Specification hardening only. No production code. Phase 1 is not opened.

هذه الدفعة تقوّي المواصفات حتى تصبح عقدًا هندسيًا لاحقًا. لا تفتح برمجة التطبيق.

## 1. New confirmed decisions / قرارات جديدة معتمدة

| ID | Status | Arabic decision | English decision | Supersedes / relates |
|---|---|---|---|---|
| DEC-038 | A | النطاق الرسمي: `chess-one.com` و`www.chess-one.com`. أي ذكر لـ `chessone.uk` تاريخ مستبدل ويبقى للتتبع. فحص العلامة القانونية ما زال مطلوبًا. | Official domains are `chess-one.com` and `www.chess-one.com`. `chessone.uk` is historical/superseded and kept for traceability. Trademark review remains required. | Domain clause inside DEC-001 |
| DEC-039 | A | إعادة تأكيد: Web First, Platform First. الويب أول عميل تنفيذ. Windows وmacOS وAndroid وiOS/iPhone/iPad ضمن النطاق. ترتيب ما بعد الويب يبقى H/TBD. | Reaffirmed: Web First, Platform First. Web is the first implementation client. Other clients are in scope. Post-Web order remains H/TBD. | DEC-030–DEC-037; CON-001 remains D |
| DEC-040 | A | `game.finished.v1` جزء أساسي من المعمارية. تُحفظ النتيجة المرجعية أولًا، ثم يُنشر الحدث بعد الالتزام الدائم. فشل المستهلك لا يلغي النتيجة. | `game.finished.v1` is core architecture. Persist the authoritative result first. Publish after durable commit. Consumer failure does not undo the result. | Closes former UC-GM-10 conflict |
| DEC-041 | A | قدرة الضيف معتمدة: لعب، تحدٍ، هوية مؤقتة، وتثبيت حساب مستقبلي آمن. ترتيب الإطلاق H/TBD وليس التزامًا تلقائيًا بأول MVP عام. طريقة إثبات ملكية التاريخ H/TBD. | Guest capability is confirmed: play, challenge, temporary identity, and future secure claim. Release sequencing is H/TBD and is not an automatic first public MVP commitment. Claim-proof method is H/TBD. | UC-ID-01, UC-ID-02, FR-ID-001, FR-ID-002, SQ-DGM-10 |
| DEC-042 | A | الخادم يبقى مرجع الساعة أثناء فقد الاتصال. التحديث أو سقوط المقبس أو خلفية الهاتف لا يوقف الساعة المرجعية. لا مدة هجر رقمية ثابتة. العتبة قابلة للتهيئة وTBD. | Server clock continues during connectivity loss. Refresh, socket drop, and mobile background do not pause it. No hard-coded abandonment duration. Threshold is configurable/TBD. | FLOW-003, SQ-DGM-02 |
| DEC-043 | A | متحكم نشط واحد لكل لاعب في المباراة التنافسية النشطة. الأجهزة الأخرى للعرض. أي استلام لاحق للتحكم يتحقق من الهوية، يصدر عقد تحكم جديدًا، يلغي القديم، يرفض الأوامر القديمة، يسجل تدقيقًا، ويعيد المزامنة من الخادم. | One active controller per player per active competitive game. Other devices are view-only. Future takeover rotates the control lease, revokes the old lease, rejects old commands, audits the action, and resyncs from the server. | Edge case: two devices |
| DEC-044 | A | نتيجة اللعب المحلي/دون اتصال ليست نتيجة خادمية رسمية، ولا تعدّل مباشرة التصنيف الرسمي أو ترتيب البطولة أو المكافآت التنافسية أو السجل المرجعي للمسيرة. أي مزامنة لاحقة تمر بعقد استيراد/تحقق صريح. | A local/offline result is not an official server result and cannot directly change official rating, tournament standing, competitive rewards, or the canonical career record. Later sync uses an explicit import/verification contract. | UC-GM-05, DEC-006 |
| DEC-045 | A | ثلاثة حدود منفصلة: مكتبة قواعد الشطرنج، سلطة المباراة الحية، عامل المحرك/الروبوت. تعطل العامل لا يوقف إنسان ضد إنسان. مباراة إنسان ضد روبوت قد تعتمد على العامل لتلك المباراة فقط. | Three separate boundaries: Chess Rules Library, Authoritative Live Game Service, Engine/Bot Worker. Worker failure does not stop human-vs-human play. A human-vs-bot game may depend on the worker for that game only. | MOD-002 scope clarification |
| DEC-046 | A | مصفوفة الطبقات 0/1/2 وسلوك التدهور لكل مجال في الطبقة 2 ملزمة كما في ملحق مجالات الفشل. مباراة نشطة سليمة لا تعتمد تزامنيًا على عمل طبقة 1 غير لازم لها. | The Tier 0/1/2 matrix and each Tier 2 degradation behavior are binding. A healthy active game does not synchronously depend on unrelated Tier 1 work. | DEC-033, DEC-034, NFR-ISO-003 |
| DEC-047 | A | أثناء مباراة مصنفة/تنافسية نشطة، Chess One لا يقدم للاعب المشارك تقييم محرك أو مساعدة نقلة لمواقف تلك المباراة عبر أي شاشة أو واجهة أو أداة أو تبويب أو وكيل داخلي. المنع على الخادم. هذا لا يدّعي منع برنامج خارج سيطرة Chess One. لا يُحزم محرك تحليل قوي داخل عميل الويب التنافسي إذا صنع مسار غش داخليًا. مكتبة القواعد منفصلة عن قدرة البحث/التحليل. | During an active rated/competitive game, Chess One must not give that participant engine evaluation or AI move help for positions from that game through any Chess One screen, endpoint, tool, tab, or internal agent. Enforcement is server-side. This does not claim prevention of software outside Chess One. Do not bundle a powerful analysis engine into the competitive Web client if that creates an internal cheating path. Rules code stays separate from search/analysis capability. | UC-AI-04, FR-AI-003, FR-AI-004 |
| DEC-048 | A | المجال لا يعدّل مباشرة جداول أو تخزين الحقيقة لمجال آخر. التواصل عبر أوامر وواجهات وأحداث ذات إصدارات وعقود صريحة. البنية الفيزيائية المشتركة لا تعني ملكية مشتركة. | A domain must not directly modify another domain's authoritative tables/storage. Communication uses commands, APIs, versioned events, and explicit contracts. Shared physical infrastructure does not mean shared ownership. | FR-ARC-004 |
| DEC-049 | A | قاعدة أسبقية المصادر في v5 ملزمة. مصدر أدنى لا يلغي قرارًا أعلى معتمدًا. تعارض عنصرين معتمدين في المستوى نفسه يُعلَّم G ويُرفع للمالك. | The v5 source/decision precedence rule is binding. A lower source cannot override a higher confirmed decision. Two same-level confirmed items in conflict are marked G and escalated. | Governance |
| DEC-050 | A | الأسماء PostgreSQL وRedis وRust وTauri وReact وSQLite وGlicko-2 وStockfish ليست اختيارات دائمة معتمدة إلا إذا وُسم كل واحد لاحقًا A بقرار مالك صريح. لا يُختار بديل في هذه الدفعة. | Those technology names are not approved permanent choices unless each is later marked A by an explicit owner decision. This batch selects no replacement. | CON-005, CON-006, section 9.2 |
| DEC-051 | A | البوابة `RULESET-FIDE-VERSION` مغلقة على خط الأساس الحالي: قوانين FIDE النافذة في 2023-01-01، والمعرّف `FIDE-E01-2023`. المباريات تحتفظ بمعرّفها. أي قوانين لاحقة إصدار جديد ومجموعة انحدار جديدة. لا إعادة تفسير صامتة. التفاصيل في المرحلة 0.5. | Gate `RULESET-FIDE-VERSION` is closed for the current baseline: FIDE Laws effective 2023-01-01, id `FIDE-E01-2023`. Games keep their ruleset id. A later FIDE text needs a new id and a new regression suite. No silent reinterpretation. | MIS-003, Q-03; owner directive Phase 0.5 |
| DEC-052 | A | حدود MVP النهائية تبقى H/TBD. المقترح في القسم 36 من v4 ليس اعتمادًا. الأساس يُصمم بحيث يختار المالك MVP لاحقًا دون إعادة تصميم الأساس. | The final MVP boundary remains H/TBD. The v4 section 36 recommendation is not approved. The foundation must let the owner choose MVP later without redesigning the foundation. | MIS-006, Q-06 |
| DEC-053 | A | فشل قراءة علم الميزة لا يكون اعتمادًا حرجًا على كل نقلة. اللقطة المحلية أو ما يعادلها كافية. الافتراض الآمن: الشطرنج الأساسي متاح، والميزة الاختيارية تُخفى أو تُعطَّل. | Feature-flag read failure must not be a per-move critical dependency. A local/cached snapshot or equivalent is required. Safe default: core chess stays available and the optional feature is hidden/disabled. | UC-TS-05, FR-ARC-005 |
| DEC-054 | A | سجل التدقيق الأمني إلحقي وذو حدود تجعل العبث قابلًا للكشف مفاهيميًا. مسؤول المجال العادي لا يمسح بصمت تاريخه الحساس. تقنية التخزين TBD. | Security audit history is append-oriented and tamper-evident at the conceptual boundary. An ordinary domain administrator must not silently erase their own sensitive audit history. Storage technology remains TBD. | Section 23 |

DEC-051 رُفع من H إلى A في المرحلة 0.5 بقرار مالك صريح على قوانين 2023-01-01. لم يُرفع أي اسم تقني في DEC-050 إلى A.

## 2. Historical decision annotation / تعليق على قرار تاريخي

| ID | Change | What remains |
|---|---|---|
| DEC-001 | جملة النطاق `chessone.uk` أصبحت D بسبب DEC-038. النص التاريخي يبقى. | اسم Chess One / تشيس ون يبقى A. فحص العلامة يبقى مطلوبًا. |

## 3. Conflicts closed in this batch / تعارضات أُغلقت

| ID | Was | Now |
|---|---|---|
| CON-013 | UC-GM-10 كان C بينما FR-ARC-003 وDEC-005 يفرضان حدث نهاية المباراة. | مغلق بـ DEC-040. UC-GM-10 أصبح A مع قاعدة الحفظ ثم النشر. |
| CON-014 | UC-ID-01 وUC-ID-02 كانا C بينما FR-ID-001 وFR-ID-002 أساسيان، ومقترح MVP غير معتمد يضم الضيف. | القدرة A بـ DEC-041. ترتيب الإطلاق وإثبات الملكية يبقيان H. لا اعتماد MVP. |
| CON-015 | القسم 11 يقول «المالك حسب الخريطة» والملحق D يعطي مجالات تقريبية. | مصفوفة `DOMAIN_DATA_OWNERSHIP_MATRIX.md` هي مرجع الملكية. الكيانات الملتبسة تبقى H. |
| CON-016 | القسم 48 يربط متطلبات المعمارية بـ MOD-014 ويربط المجتمع بالبطولة. | القسم 48 موسوم غير صالح للتنفيذ. المرجع هو `TRACEABILITY_MATRIX_V2.md`. |

## 4. Conflicts still open / تعارضات ما زالت مفتوحة

| ID | Status | Topic |
|---|---|---|
| CON-005 | G/H | Glicko-2 ليس قرارًا A. سلوك التصنيف مع عدم اليقين يبقى المبدأ. الخوارزمية والثوابت H. |
| CON-006 | G/H | Rust + Tauri + React/TypeScript + SQLite ليست حزمة معتمدة. DEC-050 يمنع اعتماد الأسماء. |
| CON-008 | D/C | بيع الحسابات ليس النطاق الحالي. النقل/الإرث ما زال قيد الدراسة. |
| CON-009 | C | التسعير والعضويات غير محسومة. No Ads وNo Pay-to-Win يبقيان A. |

لا يوجد في هذه الدفعة حل صامت لأي بند G.

## 5. Use case / requirement status edits / تصحيح الحالات

| ID | Old | New |
|---|---|---|
| UC-ID-01 | C | A كقدرة. ترتيب الإطلاق H/TBD. |
| UC-ID-02 | C | A كقدرة. طريقة الإثبات H/TBD. ترتيب الإطلاق H/TBD. |
| UC-GM-10 | C | A. الحفظ الدائم أولًا، ثم `game.finished.v1`. |
| FR-ID-001 | أساسي بلا بوابة إطلاق | القدرة A. الإطلاق H/TBD. |
| FR-ID-002 | أساسي بلا بوابة إثبات | القدرة A. الإثبات والإطلاق H/TBD. |
| SQ-DGM-10 | يثبت التاريخ بلا تمييز ما هو مفتوح | القدرة A. حقل إثبات الملكية غير مغلق. |

لم تُرفع حالات C أو F أو H الأخرى. أمثلة تبقى كما هي: UC-GM-06 المراسلة، UC-EC-* الاقتصاد، UC-CL-* وUC-RM-* وUC-AD-* المستقبلية، FTR-NEW-003 وFTR-NEW-012 وFTR-NEW-015، ومقترح MVP.

## 6. Normative annexes added / ملاحق معيارية أُضيفت

هذه الملفات جزء من مواصفة v5 في نطاقها:

- `DOMAIN_DATA_OWNERSHIP_MATRIX.md`
- `CONTRACT_CATALOG_V1.md`
- `FAILURE_DOMAIN_AND_DEGRADATION_MATRIX.md`
- `SECURITY_THREAT_MODEL_V1.md`
- `TRACEABILITY_MATRIX_V2.md`
- `TEST_ARCHITECTURE_AND_GATES_V1.md`

إذا اختلف ملحق مع قرار A في سجل القرارات، قرار A هو الأعلى، ويُسجل التعارض G بدل تعديل القرار بصمت.

## 7. Explicitly not decided / ما لم يُحسم

- رقم مهلة الهجر.
- طريقة إثبات ملكية تاريخ الضيف.
- هل يدخل الضيف أول إصدار عام.
- ترتيب Windows / macOS / Android / iOS بعد الويب.
- خوارزمية التصنيف ومعادلات الجودة وChess Mind.
- الحزمة التقنية والمزودون والسحابة.
- ملكية Certificate وCareerEvent وPieceMastery وPosition وSpectatorSession وChronicleEntry. توجد توصية هندسية معلّمة H، وليست قرار مالك.
- SLO / RTO / RPO.
- سياسة الأطفال والعمر والولاية القضائية.
- التراخيص والمزودون المدفوعون.

## 8. Preservation / الحفظ

IDEA-001 حتى IDEA-342 باقية في متن v4 المضمّن داخل v5. لم تُحذف فكرة لأن التنفيذ مبكر. F وC تعنيان لاحقًا أو غير محسوم. D تاريخ مستبدل. E، إن وُجد، يبقى في التاريخ.

## 9. Code gate / بوابة الشيفرة

لم تُفتح المرحلة 1 في المرحلة 0 ولا في 0.5.

## 10. Phase 0.5 / المرحلة 0.5

الإدارة قبلت وثائق المرحلة 0. هذه الإضافة تسجّل أمر المرحلة 0.5. لا شيفرة، ولا سقالة، ولا اعتماديات، ولا قاعدة بيانات، ولا نشر.

| Topic | Result |
|---|---|
| DEC-051 | A. Baseline `FIDE-E01-2023`. Source: FIDE Handbook `https://handbook.fide.com/chapter/e012023`. Law text is not copied into the spec |
| Move authority | Structured `from_square`, `to_square`, conditional `promotion_piece`. Server builds canonical SAN. Client SAN is not authority |
| Idempotency | Same id and same semantic payload replays the binding decision with `replayed_response = true`. A different payload is `InvalidCommandIdentity` and does not execute |
| Actor | Session + control lease + server seat. Client `actor_id` cannot assign a seat |
| Technology | Compared in `TECHNOLOGY_DECISION_ANALYSIS_V1.md`. The engineering recommendation is not an A decision. DEC-050 and CON-006 stay as they were |
| Repository | Proposed only in `PROPOSED_REPOSITORY_ARCHITECTURE_V1.md`. The tree was not created |

ملفات المرحلة 0.5:

- `PHASE_0_5_CONTRACT_CORRECTIONS.md`
- `TECHNOLOGY_DECISION_ANALYSIS_V1.md`
- `PROPOSED_REPOSITORY_ARCHITECTURE_V1.md`

ما زال مفتوحًا عند إغلاق المرحلة 0.5: أي إصدار FIDE لاحق، التصنيف، MVP، إثبات الضيف، رقم الهجر، وبقية بوابات H. اعتماد عائلة الحزمة جاء لاحقًا في المرحلة 0.6.

## 11. Phase 0.6 / المرحلة 0.6

توجيه المالك سُجّل كقرارات A. ملف v5 بقي دون تعديل. المرجع الجديد `CHESS_ONE_FINAL_PROGRAMMING_SPEC_BILINGUAL_v6_CODE_READY.md`. لا سقالة ولا اعتماديات ولا قاعدة ولا نشر.

| ID | Status | Decision |
|---|---|---|
| DEC-055 | A | Engineering constitution |
| DEC-056 | A | Candidate A stack families. Individual approval required by DEC-050, limited to the names in the stack record |
| DEC-057 | A | Major family is architecture. Patch pins live in a future lockfile. Currency date 2026-09-28 |
| DEC-058 | A | One pnpm workspace. No Nx/Turborepo yet. No empty native-client folders |
| DEC-059 | A | Go and Rust are future candidates only. No Redis, broker, or Kubernetes by habit |
| DEC-060 | A | Online play policy is not FIDE |
| DEC-061 | A | Monotonic receipt time. Processing delay after a timely receipt is not player time |
| DEC-062 | A | No false dead-position draw. Full detector remains BLOCKED/PARTIAL |

CON-006 stays open for Tauri, SQLite, and Rust-as-day-one. React 19 as the web UI and PostgreSQL 18 stable are inside DEC-056. CON-005 stays G/H. Glicko-2 and Stockfish stay unapproved.

ما زال مفتوحًا: خوارزمية الموضع الميت الكاملة، تقاطعها مع قاعدة الخمس والسبعين، ترخيص توزيع Chess One وبالتالي توافق مكتبات GPL، تعويض التأخير، النقلة المسبقة، مهلة الهجر، وحدود MVP.

## 12. Phase 1 Batch 1 preflight / تمهيد الدفعة 1 من المرحلة 1

تصحيحات وثائقية قبل أول شيفرة. ملف v5 بقي دون تعديل. DEC-061 لم يتغير.

| ID | Status | Decision |
|---|---|---|
| DEC-063 | A | `received_at` is stamped inside the Authoritative Live Game Writer's monotonic clock domain, at ingress, before rule processing or the writer's internal queue. No Web-client monotonic stamp. No edge-process monotonic stamp is treated as comparable. A trusted cross-process ingress timing protocol is not approved. Wall clock may cross processes for audit only |
| DEC-064 | A | Mating-possibility `UNKNOWN` is never mapped by Phase 1 code to an official win, loss, or draw. It is the unresolved adjudication state `MATING_POSSIBILITY_UNRESOLVED`. It produces no `game.finished.v1`, rating, reward, tournament standing, or official career result. The final adjudication policy is a later gate. This supersedes the earlier text that treated `UNKNOWN` as a loss on time or resignation |

Other preflight corrections, with no new decision:

- `TEST_ARCHITECTURE_AND_GATES_V1.md`: the flag row now uses the DEC-061 received-at model. The old apply-time wording is removed.
- `TECHNOLOGY_DECISION_ANALYSIS_V1.md`: stale statements that React and PostgreSQL are unapproved now point to DEC-056. Redis, brokers, Kubernetes, Tauri, SQLite as the product database, Rust or Go as day-one languages, Glicko-2, and Stockfish stay unapproved as day-one defaults.
- `CHESS_RULES_GOLDEN_TEST_LEDGER_V1.md`: 008a had no black king. It is replaced by `1k3r2/8/8/8/8/8/8/R3K2R w KQ - 0 1`. Positive `threefold_intended` (018b) and `fifty_move_intended` (020b) rows were added, with an incorrect fifty-move intended claim (020c). Rows 015b, 015c, 016a, and 016e follow DEC-064.
- `CHESS_RULES_GOLDEN_TEST_LEDGER_V1.md`: 014d had the d2 knight checking the black king with White to move. It is replaced by `8/8/8/8/4k3/8/2N1N3/4K3 w - - 0 1`. Rows 015a and 016b used a position already finished under 5.2.2 and now expect no resignation or flag effect.
- The dead-position problem is not solved. GAP-MATE-001 now names the missing adjudication policy. GAP-MATE-004 records that 5.1.2 and 6.9 need a one-sided mating check that does not exist yet.
