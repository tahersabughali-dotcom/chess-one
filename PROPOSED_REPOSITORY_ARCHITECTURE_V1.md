# Proposed Repository Architecture v1 / معمارية المستودع المقترحة — الإصدار 1

**Status / الحالة:** Superseded for the tree shape by DEC-058. The approved folders are in `STACK_DECISION_RECORD_V1.md` and `ENGINEERING_CONSTITUTION_V1.md`. This file remains the dependency-direction analysis. No folders were created.  
**الحالة:** شكل الشجرة في DEC-058 أعلى من الشجرة أدناه. اتجاه التبعية هنا يبقى مفيدًا. لم يُنشأ مستودع.  
**Binds to / يرتبط بـ:** DEC-039 Web First, DEC-045 process boundaries, DEC-048 no cross-domain writes, DEC-050 no stack approval.

## 1. Intent / القصد

مستودع واحد (Monorepo) يخدم الويب أولًا، ثم عملاء لاحقين، دون أن يصبح مجلدًا تستورد فيه كل حزمة كل الحزم.  
العقود المشتركة وقواعد الشطرنج النقية تعيش في جذور ضيقة. تطبيقات الخادم والعمال والعملاء تتجه تبعياتها إلى الداخل نحو تلك الجذور، ولا تتجه الجذور إليها.

## 2. Proposed tree / الشجرة المقترحة

```text
chess-one/
  docs/                          specifications and decisions
  contracts/                     versioned command and event shapes only
  domain/
    chess-rules/                 pure rules selected by ruleset_id
    game-values/                 squares, sequences, clock ticks as values
  server/
    edge/                        session edge and route entry
    live-game/                   authoritative game process
    modules/
      identity/
      matchmaking/
      rating/
      history/
      trust/
      admin/
    workers/
      engine-bot/
      analysis/
      outbox/
  clients/
    web/                         first client
    windows/                     future placeholder docs only, until a later phase
    macos/
    android/
    ios/
  tests/
    rules/
    contracts/
    boundaries/                  future import-direction checks
  infra/                         later definitions. empty of deployable environments now
```

المجلدات المستقبلية للعملاء الأصليين تبقى وثائق حجز مكان عند فتح التنفيذ لاحقًا. هذه الدفعة لا تنشئ الشجرة.

## 3. Dependency direction / اتجاه التبعية

مسموح أن يشير السهم إلى الهدف. العكس ممنوع.

| From | May depend on | Must not depend on |
|---|---|---|
| `contracts` | nothing inside `server` or `clients` | domain services, UI, workers |
| `domain/chess-rules` | `domain/game-values` only | network, clock authority, accounts, engine search, any client |
| `domain/game-values` | nothing in server or clients | I/O |
| `server/live-game` | rules, game values, contracts | analysis, economy, AI, Chess Land, search, notifications |
| `server/modules/*` | contracts, and its own storage port | another module's tables; live-game internals |
| `server/edge` | contracts and session facts | rules search, payment webhooks writing games |
| `workers/engine-bot` | rules as a pure library, its own job contract | human move acceptance |
| `workers/analysis` | its own job contract | live-game write APIs |
| `workers/outbox` | event contracts | source-domain tables other than the outbox it is allowed to read |
| `clients/web` | contracts; rules only for local/unofficial play | `server/modules`, worker internals |
| `clients/windows` and later native clients | the same share rules as web | each other, and server internals |
| `tests/boundaries` | the dependency declarations | production secrets |

قاعدة عملية: لا ملف «برميل» يعيد تصدير الخادم والعميل والقواعد معًا. الاستيراد العميق عبر حدود المجال يفشل في فحص الحدود عندما تُكتب الاختبارات لاحقًا.

## 4. What sharing means / معنى المشاركة

| Class | Lives where | Rule |
|---|---|---|
| Must share | Rules behavior via one library plus the golden vectors for `FIDE-E01-2023`; command and event contracts | Two handwritten rule engines are a defect |
| Should share | Identity concepts, validation of squares and sequences, security policy statements | Generated or shared types, not copied prose in each client |
| May share | Design tokens, some presentation-neutral formatters for SAN display | A client may replace them |
| Must stay local | Navigation, OS lifecycle, push shell, packaging, store listing, input gestures | No requirement that pixels match |

اللعب المحلي يستدعي مكتبة القواعد داخل العميل، ونتيجته تبقى غير رسمية (DEC-044). اللعب التنافسي يرسل `SubmitMoveCommand.v1` ولا يصدق نتيجة محلية.

## 5. Day-one physical versus logical split / الفصل الفيزيائي والمنطقي

هذا القسم يكمّل تحليل التقنية. الفصل هنا حدود عمليات، لا أسماء منتجات.

فيزيائي من اليوم الأول، حتى لو اجتمعت العمليات على آلة واحدة صغيرة:

- عميل الويب، كحزمة تُسلَّم للمتصفح بمعزل عن عملية المباراة.
- عملية سلطة المباراة الحية.
- عملية مدخل الواجهة والجلسة، إذا كان إعادة تشغيلها لازمة دون لمس الساعة. يجوز أن تبدأ قريبة من وحدات الهوية، بشرط أن جاهزية النقلة لا تنتظر جاهزية وحدة غير لازمة.
- عامل المحرك/الروبوت.
- عامل التحليل.
- عملية قراءة السجل الصادر وتنفيذ المستهلكين غير المتزامنين.

منطقي في البداية، داخل عملية المنصة ذات الحدود الصارمة، لا كخدمات مصغّرة لكل مجال:

- الهوية والملف والخصوصية.
- المطابقة.
- مستهلِك التصنيف.
- القراءة التاريخية.
- لقطة أعلام الميزات.
- إلحاق التدقيق عبر واجهة إلحاق، وتقنية التخزين ما زالت TBD.

ممنوع داخل عملية المباراة الحية حتى في أصغر تشغيل: بحث المحرك، التحليل، مزود الذكاء، المتجر، Chess Land، الإشعارات، وبناء فهرس البحث.

## 6. Growth without a new repository shape / النمو دون شكل مستودع جديد

عند قياس حاجة لاحقة تُسحب عملية واحدة إلى نشر مستقل، وتبقى في مكانها داخل الشجرة. لا يُعاد تقسيم المستودع لكل لغة. إذا انتقلت سلطة المباراة لاحقًا إلى لغة أخرى، تبقى العقود ومكتبة الاختبار الذهبية في الجذر، وتتحدث العملية الجديدة إليهما. هذا الإبدال قرار لاحق، وليس جزءًا من إنشاء المستودع.

## 7. Enforcement / الفرض

عند فتح التنفيذ لاحقًا، فحص `tests/boundaries` يرفض استيرادًا يخالف القسم 3. حتى ذلك الحين لا توجد شيفرة تفرض القاعدة. الوثيقة هي القاعدة.
