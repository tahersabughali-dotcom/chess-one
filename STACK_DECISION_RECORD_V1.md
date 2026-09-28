# Stack Decision Record v1 / سجل قرار الحزمة — الإصدار 1

**Decisions / القرارات:** DEC-056, DEC-057, DEC-058, DEC-059.  
**Currency date / تاريخ مراجعة العملة:** 2026-09-28.  
**This record does not install, scaffold, or deploy.**

## 1. What is approved / ما اعتُمد

المرشح A من تحليل المرحلة 0.5 أصبح خط البداية المعتمد. الاعتماد على **عائلة الإصدار الكبرى**. رقم التصحيح في الجدول التالي مشاهدة في تاريخ العملة، ويُعاد فحصه عند السقالة، ثم يُقفل في ملف القفل. هو ليس ثابتًا معماريًا.

| Family | Approved line | Forbidden on the critical path | Last observed stable evidence on 2026-09-28 |
|---|---|---|---|
| Language | TypeScript 7.x | Nightly / `typescript@next` | 7.0.2 |
| Server runtime | Node.js 24.x LTS | Node.js Current غير LTS، ومنها خط 26 طالما لم يصبح LTS الإنتاجي المعتمد | 24.21.0 LTS. دعم الإصلاحات النشطة المعلن ينتهي 2026-10-20، ودعم الأمن المعلن يستمر حتى 2028-04-30. البقاء على 24 قرار المالك، لا انتقال تلقائي إلى 26 |
| Web | Next.js 16.x Active LTS | RC, beta, canary. الخط 16.4.0-canary المرئي في سجل الإصدارات ممنوع | 16.3.6 |
| UI library | React 19 stable, minimum the 19.3 stable line when that line is the compatible stable | Canary builds, including example canaries shown beside the 19.3 announcement | 19.3.0 published 2026-09-09. عند السقالة: أحدث تصحيح أمني مستقر داخل 19.3 متوافق مع Next 16 |
| API / edge | Fastify 5.x | Fastify 3 and older EOL | 5.12.3 |
| Database | PostgreSQL 18.x stable | PostgreSQL 19 beta/RC, and any 18 beta | 18.6 released 2026-08-13. PostgreSQL 19 Beta 3 موجود في الخبر نفسه وممنوع |
| SQL access | Kysely stable | An ORM that hides transaction boundaries | 0.29.6. اعتمادياته التطويرية، مثل SQLite، ليست اعتماديات Chess One |
| Workspace | pnpm 12.x | pnpm 11 merely because the npm `latest` tag still pointed at 11 | 12.0.0 announced stable 2026-08-26. التثبيت من وسم خط 12، لا من `latest` إذا بقي يشير إلى 11 |
| Format / lint | Biome stable | — | Exact patch not confirmed in this check. Resolve from the stable tag at scaffold |
| Unit / property tests | Vitest stable and fast-check stable | Vitest beta peers are not the product test runner | Vitest 5.0.0 observed 2026-09-03. fast-check exact patch unresolved; stable tag at scaffold |
| E2E | Playwright stable, when E2E starts | Not required to install in the first rules slice | No Chess One pin. A version seen in another package's dev tree is not our pin |
| Telemetry | OpenTelemetry-compatible API | A vendor agent as a required move-path dependency | API compatibility, not a vendor |

## 2. Version policy / سياسة الإصدار

- عائلة المعمارية معتمدة هنا.
- النسخة الدقيقة تُقفل لاحقًا في lockfile وحقل `packageManager` لـ pnpm.
- ترقيع الأمن إلزامي داخل العائلة المعتمدة.
- لا ترقية كبرى تلقائية.
- الترقية الصغرى أو الكبرى تمر باختبارات التوافق، ومنها متجهات `FIDE-E01-2023` إذا مست القواعد أو الساعة أو العقود.
- تنبيه أمني حرج أو عالٍ على مسار حرج يفتح مراجعة فورية.
- قبل أي نشر إنتاجي لاحق: لا اعتمادية معروفة بثغرة حرجة على المسار الحرج.
- بيتا وRC وcanary وnightly ليست «أحدث» مقبولًا.

## 3. Explicitly not day-one infrastructure / ما ليس بنية اليوم الأول

| Item | Status |
|---|---|
| Redis | Not added by habit. Process-local non-authoritative cache only where loss cannot change a result, a clock, or a rating |
| Kafka, NATS, RabbitMQ | Not added. Events start as a transactional outbox plus a separate dispatcher/consumer. A broker waits for a measured need |
| Kubernetes | Not added by habit |
| A microservice per domain | Rejected |
| Go | Not a day-one language. Future extraction candidate for the Authoritative Live Game process only if benchmarks show the TypeScript runtime cannot keep clock fairness or connection cost |
| Rust | Not a day-one product language. Future specialist candidate for a small rules core, WASM sharing, or a worker if measurement or cross-platform rules sharing justifies it |
| SQLite, Tauri, Glicko-2, Stockfish | Still not approved. DEC-050 still covers them |
| Nx, Turborepo | Not in the initial workspace. Reconsider only after measured build or task-graph pain |

## 4. Process shape / شكل العمليات

كما في المرحلة 0.5، مع لغة واحدة معتمدة:

- عميل الويب منفصل.
- مدخل Fastify للواجهة والجلسة.
- عملية المباراة الحية.
- عمال المحرك والتحليل والسجل الصادر عمليات منفصلة.
- الهوية والمطابقة ومستهلك التصنيف والسجل وحدات منطقية داخل `server/platform`.

مخزن PostgreSQL واحد في البداية مقبول إذا اختلفت صلاحيات الكتابة بين المجالات. جدول الحقيقة لا يُشارَك. السجل الصادر يُكتب في التزام النتيجة نفسه.

## 5. Currency gaps / فجوات العملة

Biome وfast-check ورقعة pnpm الأحدث من 12.0.0 ورقم Playwright لم تُثبت كلها من سجل الحزم في هذه الدفعة لأن التثبيت ممنوع. السقالة اللاحقة تقرأ الوسم المستقر وتعيد فحص التنبيهات الأمنية. إذا ظهر أن مشاهدةً أعلاه لم تعد المستقر، العائلة تبقى والتصحيح يتغير. إذا اختفت العائلة الكبرى أو أصبحت تجريبية، هذا تعارض G ويُرفع، ولا يُستبدل بصمت.

## 6. Supersession / الأثر على القرارات الأقدم

DEC-050 قالت إن الأسماء لا تصبح A إلا بقرار فردي. DEC-056 هو ذلك القرار للأسماء الموجودة في القسم 1 فقط. جملة تحليل المرحلة 0.5 التي قالت إن التوصية ليست A أصبحت تاريخ تحليل، والاعتماد في DEC-056.
