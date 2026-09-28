# Technology Decision Analysis v1 / تحليل قرار التقنية — الإصدار 1

**Status / الحالة:** Analysis record. Phase 0.6 owner decision DEC-056 approves Candidate A as the starting baseline. This file does not override that decision, and it does not approve Go or Rust as day-one languages.  
**الحالة:** سجل التحليل. قرار DEC-056 في المرحلة 0.6 اعتمد المرشح A كخط بداية. هذه الوثيقة لا تلغيه، ولا تجعل Go أو Rust لغة إنتاج في اليوم الأول.  
**Does not authorize / لا يأذن بـ:** application code, scaffold, dependencies, framework initialization, database creation, or deployment.

Web remains the first client (DEC-039). Post-Web client order remains H/TBD.

**Current status after DEC-056 / الحالة الحالية بعد DEC-056:**

- Approved starting families: TypeScript 7, Node.js 24 LTS, Next.js 16 Active LTS, React 19 stable, Fastify 5, PostgreSQL 18 stable, Kysely, pnpm 12, Biome, Vitest, fast-check, Playwright later, and OpenTelemetry-compatible telemetry.
- Still not approved as day-one defaults: Redis, Kafka/NATS/RabbitMQ, Kubernetes, Tauri, SQLite as the product database, Rust as a day-one product language, Go as a day-one product language, Glicko-2, and Stockfish.

جمل هذا التحليل التي تقول إن React أو PostgreSQL «غير معتمد» أو إن إطار الواجهة أو منتج قاعدة البيانات «غير مختار» كانت صحيحة وقت كتابتها في المرحلة 0.5. الحالة الحالية أعلاه، وDEC-056 هو المرجع.

## 1. How to read this file / كيف يُقرأ

المقارنة خاصة بـ Chess One: مباراة حية مرجعها الخادم، ساعة لا يملكها العميل، مكتبة قواعد حتمية بمعرّف `FIDE-E01-2023`، وعزل عطل المحرك عن لعب البشر. الشعبية وحدها لا ترفع مرشحًا.

لا يُصمَّم في اليوم الأول تشغيل لمليون متصل. الهدف البعيد يسمح بالنمو المقاس. التكلفة تبقى متناسبة مع الاستخدام الفعلي.

لا مرشح D. سبب الإضافة كان سيصبح «ثلاث لغات في اليوم الأول» أو «نواة WASM قبل أي قياس». كلاهما يعجّل تعقيدًا يمكن تأجيله. مسار WASM مذكور كتحول لاحق داخل المرشح C، لا كعمارة انطلاق.

## 2. Starting shape shared by every candidate / شكل البداية المشترك

التوصية الحدودية، قبل اللغة:

**Modular monolith مع عمليات معزولة حيث يفرض العطل أو الأداء ذلك.** ليست خدمات مصغّرة لكل مجال.

| Boundary | Day-one placement |
|---|---|
| Web client | Physically separate deliverable |
| API / edge | Own entry and readiness. May share a host with non-game modules |
| Authoritative live game | Own process. One writer per game |
| Engine / bot workers | Own process and queue. Human games ignore it |
| Analysis workers | Own process and queue |
| Outbox consumers | Own process. They read after commit |
| Identity, matchmaking, rating consumer, history, flags, audit append | Logically separate modules. Same platform process is acceptable at the start |

سبب هذا الشكل: أصغر عطل يبقى أصغر عطل. إعادة نشر المتجر أو تعطل محرك التحليل لا يعيد تشغيل ساعة مباراة قائمة. في المقابل، خدمة مصغّرة للهوية وللملف وللخصوصية وللمطابقة من اليوم الأول تضيف أعطال شبكة على مسار لا يحتاجها، قبل وجود حمل يبررها.

الانتقال اللاحق: تُسحب العملية التي أظهر القياس أنها تحتاج نشرًا مستقلًا. لا تُفكك المنصة سلفًا.

## 3. Scale path / مسار النمو

الأرقام أدناه أهداف معمارية للمقارنة، وليست وعد إطلاق ولا SLO معتمدًا. SLO ما زال H.

| Stage | What changes | What stays |
|---|---|---|
| 10k concurrent active games | One live-game process, or a few, with game affinity. One transactional store. Flag snapshot in memory. Spectators on a side channel | Single writer per game. Outbox after commit |
| 50k | More live-game processes partitioned by `game_id`. Sticky routing. Spectator snapshots split from move acceptance | No second writer |
| 100k | Dedicated fanout for spectators. Presence cache only if more than one game process must share it | Move path still avoids remote flag reads |
| 250k | Live-game data partitioned by game. Engine and analysis fleets scale on their own queues | Rating and rewards stay async |
| 500k to 1M+ | Re-measure the live-game runtime. Extract that process only if the current runtime misses clock fairness or connection cost | Contracts, ruleset id, and golden vectors remain |

آلة بلا حمل لا تُشترى سلفًا. التقسيم يُفتح عندما يفشل القياس، لا عندما يبدو المليون ممكنًا على الورق.

## 4. Candidate A — TypeScript-centric platform

### Architecture description

عميل الويب وخادم المنصة وسلطة المباراة الحية ومكتبة القواعد بلغة TypeScript واحدة، في العمليات المنفصلة المذكورة في القسم 2. إطار الواجهة كان غير مختار وقت التحليل. الحالة الحالية: Next.js 16 وReact 19 المستقر معتمدان في DEC-056. بيئة تشغيل الخادم تبقى داخل عائلة بيئات TypeScript المناسبة لواجهات الويب والاتصال اللحظي، بلا تثبيت منتج في هذه الوثيقة.

مكتبة القواعد حزمة نقية بلا شبكة وبلا ساعة. اللعب المحلي غير الرسمي يستدعيها داخل المتصفح. اللعب الرسمي يمر بـ `SubmitMoveCommand.v1`.

### Advantages

- لغة واحدة للعقود والقواعد والمباراة والعميل الأول، فيقلّ احتمال نسختين من الشرعية.
- حلقة فحص الأنواع والتنسيق والاختبار قصيرة، وهذا يناسب تنفيذًا كثيره عبر Cursor.
- عزل المباراة على كاتب واحد داخل حلقة أحداث تعاونية يطابق تسلسل الأوامر: حالة المباراة لا تُشارَك بين خيوط تكتب معًا.
- التحقق من النقلة رخيص. البحث الثقيل أصلًا خارج العملية.
- مسار النمو في القسم 3 لا يطلب إعادة كتابة مبكرة.

### Disadvantages

- الذاكرة لكل اتصال لحظي أعلى من لغات الأنظمة، فيظهر أثرها عند كثافة المشاهدين قبل أن تظهر في حساب الشرعية.
- كنس الساعات يحتاج عجلة توقيت أو ما يعادلها. مؤقّت لكل مباراة يصبح عبئًا عند عشرات الآلاف.
- الأعداد العشرية الثنائية خطر على الساعة إذا تُركت بلا قيد. العقد يغلق هذا بمللي ثانية صحيحة، واللغة لا تمنعه وحدها.
- سطح المكتبات واسع، والوكيل قد يخترع واجهة حزمة غير موجودة.
- حدود المعمارية لا تُفرض باللغة. تحتاج فحص استيراد لاحقًا كما في اقتراح المستودع.

### Performance implications

قبول نقلة شرعية يبقى عملًا صغيرًا. عنق الزجاجة المتوقع هو عدد الاتصالات والساعات والمشاهدين، لا عمق البحث. المرشح يكفي مراحل 10k و50k إذا بقي المشاهدون خارج عملية القبول. عند 100k وما بعد يُقاس كنس الساعة وتكلفة الاتصال قبل أي انتقال لغة.

### Reliability implications

عزل العمليات يعطي العزل المطلوب حتى مع لغة واحدة. جمع المباراة الحية مع التحليل في عملية واحدة يلغي هذا المكسب، وهو ممنوع في القسم 2. أخطاء الذاكرة من نوع الاستخدام بعد التحرير أقل ظهورًا بسبب الجمع الآلي، وتبقى أخطاء التسلسل والمنطق هي الخطر الأعلى.

### Security implications

أنواع TypeScript الصارمة تقفل جزءًا من الخلط بين مقعد العميل ومقعد الخادم إذا كانت الأنواع لا تسمح بحقل سلطة اسمه `actor_id` إلا كصدى اختياري. هذا لا يغني عن الفحص الخادمي. حزمة قواعد في المتصفح قابلة للتعديل محليًا؛ التعديل لا يمنح تقييم محرك ما دام محرك التحليل غير مضمّن في العميل التنافسي (DEC-047). برنامج خارج المنصة يبقى خارج الادعاء.

### Scaling implications

التوسع أفقي بتقسيم `game_id`، ثم بفصل بث المشاهدين. استخراج عملية المباراة إلى لغة أخرى لاحقًا ممكن إذا بقيت المتجهات الذهبية هي عقد القواعد. التكلفة المبكرة منخفضة لأن التشغيلة الأولى صغيرة.

### Cross-platform implications

العملاء اللاحقون يستهلكون العقود نفسها. مشاركة مكتبة القواعد مع عميل أصلي لاحق ممكنة إذا استُضيفت بيئة TypeScript، أو عبر المتجهات الذهبية إذا كُتبت القواعد هناك بلغة أخرى. لا تُفرض واجهة ويب على Windows أو iOS.

### Cursor/AI implications

التغذية الراجعة سريعة: فحص أنواع، تنسيق حتمي، اختبارات قصيرة. الخطر هو واجهات متخيلة وكثرة الأطر المتشابهة. تقليله يكون بعقد النقلة المغلق، وبمنع استيراد عابر للحدود، وبعدم فتح إطار واجهة قبل قرار مالك. شهرة اللغة تزيد الأمثلة الصحيحة والخاطئة معًا.

### Operational complexity

الأقل بين المرشحين: سلسلة بناء واحدة، ومراقبة عملية مباراة وعمال منفصلين. لا جسر لغات في مسار النقلة.

### Migration/evolution risk

الخطر المكلف هو السماح بنسختين من القواعد، أو إدخال البحث داخل عملية المباراة. نقل عملية المباراة لاحقًا إلى Go أو Rust يبقى ممكنًا ما دامت المتجهات الذهبية والعقود ثابتة. نقل الواجهة من إطار لم يُختر بعد رخيص الآن، ويغلو بعد بناء الشاشات.

## 5. Candidate B — TypeScript Web + Go critical backend

### Architecture description

عميل الويب وأشكال العرض بلغة TypeScript. سلطة المباراة الحية، والساعة، والاتصال اللحظي للمباراة، بلغة Go في عملية مستقلة. العقود تُولَّد للجانبين من `contracts/`. مكتبة القواعد إما تعيش في Go ويُتحقق منها بالمتجهات الذهبية، وإما تُنسخ في TypeScript للعب المحلي. النسخ اليدوي خطر ما لم تكن المتجهات هي الحكم.

وحدات الهوية والمطابقة والتصنيف يمكن أن تبدأ في عملية المنصة بلغة واحدة، وتستدعي المباراة الحية عبر العقد لا عبر جداولها.

### Advantages

- كثافة الاتصالات وكفاءة الذاكرة أنسب لمسار 100k فما فوق دون تغيير الشكل.
- المترجم صغير اللغة، ورسائل الخطأ مباشرة، والتنسيق بأداة واحدة حتمية.
- التزامن بالقنوات يناسب طوابير العمال وعزل الكاتب لكل مباراة إذا ضُبطت الملكية بحيث لا يكتب كيانان المباراة نفسها.
- التوظيف اللاحق لخوادم الاتصال أوسع من Rust وأضيق من TypeScript.

### Disadvantages

- لغتان من اليوم الأول: كل تصحيح عقد يمر بمولّد أو ينحرف.
- اللعب المحلي يحتاج القواعد على العميل. نسخة TypeScript ثانية بجانب Go تعني خطر اختلاف الشرعية إن ضعفت المتجهات.
- Cursor يتنقل بين لغتين، ويزيد احتمال تعديل الجانب الخطأ.
- مكسب الأداء في اليوم الأول غير مثبت بقياس Chess One. الحمل الأول أقرب إلى 10k منه إلى 1M.

### Performance implications

تكلفة الاتصال والكنس المتوازي أفضل من المرشح A عند الكثافة العالية. فرق قبول نقلة واحدة لن يُحسّ في مباراة بشرية. المكسب يظهر في عدد المباريات على العملية الواحدة وفي بث المشاهدين.

### Reliability implications

حد العطل أوضح لأن عملية المباراة بلغة وخدمة نشر مستقلتين عن واجهة الويب. الجسر بينهما نقطة فشل جديدة: انقطاع داخلي بين الحافة والمباراة يجب أن يظهر كـ `TransportInterrupted` لا كنتيجة محلية.

### Security implications

الذاكرة الآمنة ليست ضمان Rust، والجمع الآلي يغلق فئة من أخطاء الذاكرة. حدود السلطة تبقى في العقد وفي رفض `actor_id`. مولّد العقود يقلل حقلًا زائدًا يمنحه الوكيل سلطة عن طريق الخطأ.

### Scaling implications

المسار في القسم 3 يبدأ أقوى عند 100k–250k. مراحل 10k و50k لا تحتاج هذا الفاصل اللغوي لتتحقق. استخراج لاحق من A إلى B أرخص من البدء بـ B ثم التراجع.

### Cross-platform implications

العملاء الأصليون يتحدثون العقود المولَّدة. القواعد المشتركة مع iOS أو Android ليست تلقائية. المتجهات الذهبية هي جسر الصحة إذا بقيت نسخة واحدة على الخادم ونسخة عميل للعب المحلي فقط.

### Cursor/AI implications

Go أصعب في هلوسة مكتبة قياسية لأن السطح أصغر، والاختبارات سريعة. الغموض ينتقل إلى حد اللغتين: الوكيل قد يكتب مدقق شرعية في TypeScript «مؤقتًا» ثم يبقى. هذا أسوأ فشل معماري محتمل للمرشح.

### Operational complexity

متوسط: سلسلتا بناء، ومولّد عقود، ونشر عملية Go بجانب واجهة TypeScript. ما زال أبعد ما يكون عن خدمات مصغّرة لكل مجال.

### Migration/evolution risk

الانطلاق هنا يجعل الرجوع إلى لغة واحدة مكلفًا بعد أول آلاف الأسطر. البقاء على العقود المولَّدة يجعل تبديل عميل الويب رخيصًا. تبديل قواعد Go بعد كتابة نسخة عميل ثانية مكلف.

## 6. Candidate C — TypeScript Web + Rust critical backend

### Architecture description

عميل الويب TypeScript. نواة المباراة و/أو مكتبة القواعد بـ Rust. المسار الأقوى معماريًا داخل هذا المرشح هو مكتبة قواعد واحدة تُترجم أيضًا إلى WASM للعب المحلي في المتصفح، مع بقاء السلطة الرسمية على الخادم. عامل المحرك يمكن أن يكون عملية Rust لاحقًا دون أن يكون Stockfish قرارًا، فاسم Stockfish ما زال غير معتمد.

### Advantages

- أقوى ضمان لغة ضد أخطاء الذاكرة ومشاركة الحالة.
- مسار مشاركة واحدة للقواعد بين الخادم واللعب المحلي عبر WASM، إذا قُبلت تكلفة البناء.
- سقف الكفاءة مناسب لمرحلة 500k–1M إذا وصل المنتج إليها.
- المتجهات الذهبية نفسها تحمي الترجمة إلى WASM من الانحراف.

### Disadvantages

- أبطأ حلقة تطوير، وأصعب مسار على وكيل يكتب معظم المنتج.
- أخطاء الأعمار والاقتراض تستهلك دورات قبل أن يصل العمل إلى قواعد الشطرنج.
- WASM يضيف هدف بناء وتشخيصًا في المتصفح قبل وجود لعب محلي مقاس.
- التوظيف اللاحق أضيق وأغلى.
- DEC-050 يذكر Rust صراحة كاسم غير معتمد. هذا المرشح لا يغيّر ذلك.

### Performance implications

قبول النقلة لن يصبح أسرع بما يحسّه اللاعب. المكسب في الذاكرة والذيل الزمني تحت كثافة عالية، وفي استضافة عامل بحث لاحقًا بجانب النواة دون خلط العمليتين. خلط البحث مع قبول نقلة البشر يلغي عزل DEC-045 حتى بلغة آمنة.

### Reliability implications

المترجم يمنع فئة من حالات السباق إذا بقيت المباراة خلف ملكية واضحة. تعقيد البناء نفسه مصدر أعطال تشغيل: هدف WASM وهدف الخادم قد يفترقان إن لم تكن المتجهات إلزامية. العزل التشغيلي يأتي من العمليات المنفصلة، لا من اللغة وحدها.

### Security implications

أقوى مرشح إذا أصبحت القواعد مكتبة أصلية داخل عملاء غير موثوقين. هذا لا يمنع محركًا خارجيًا، ولا يبرر شحن محرك تحليل داخل عميل الويب التنافسي. رفض المساعدة التنافسية يبقى سياسة خادم (DEC-047).

### Scaling implications

أفضل سقف نظري. أسوأ تكلفة للوصول إلى أول 10k. المسار المقاس يسمح بالانتقال إلى هذا السقف لاحقًا من A أو B إذا فشلت القياسات، بشرط ثبات المتجهات.

### Cross-platform implications

WASM يخدم الويب واللعب المحلي. عملاء iOS وAndroid الأصليين لا يستهلكون WASM تلقائيًا كواجهة. نواة Rust يمكن ربطها لاحقًا كمكتبة أصلية، وهذا قرار عميل لاحق لا ترتيب عملاء مخترع.

### Cursor/AI implications

أقوى رد فعل من المترجم عند الخطأ، وأضعف معدل وصول إلى شيفرة صحيحة من المحاولة الأولى. الوكيل يخترع أنماط أعمار غير موجودة في واجهات شائعة. الإصلاح الآمن موجود، والسرعة ضعيفة. هذا ثمن مقبول لنواة صغيرة معزولة، ومرتفع إذا كُتب به المنتج كله.

### Operational complexity

الأعلى: بناء Rust، وربما WASM، بجانب TypeScript، مع أدوات وفحص أطول في التكامل المستمر. التشخيص في الإنتاج يحتاج رموزًا وخرائط للهدفين.

### Migration/evolution risk

البدء هنا يثبّت تكلفة لا تُسترد إذا بقي الحمل عند عشرات الآلاف. البدء في A مع متجهات ذهبية يجعل القدوم إلى C لاحقًا انتقال نواة لا إعادة منتج. هذا هو اتجاه التطور الأرخص.

## 7. Criteria matrix / مصفوفة المعايير

التقدير لـ Chess One في مرحلة البداية مع مسار القسم 3. «قوي» يعني مناسبًا للقيد، لا أنه الأفضل في المطلق.

| Criterion | A | B | C |
|---|---|---|---|
| Web First suitability | قوي | قوي للعميل، والحد اللغوي زائد مبكرًا | قوي للعميل، والنواة تعيق أول تسليم |
| Platform First, later native clients | قوي عبر العقود | قوي عبر عقود مولَّدة | قوي للعقود، ومشاركة القواعد الأصلية مؤجّلة |
| Reuse without rebuilding backend | قوي | قوي | قوي |
| Shared contracts | قوي داخل لغة واحدة | قوي إذا بقي المولّد إلزاميًا | قوي إذا بقي المولّد إلزاميًا |
| Chess rules determinism | قوي بنسخة واحدة | حسّاس لنسخة ثانية | قوي إن بقيت نسخة Rust/WASM واحدة |
| Realtime game performance | كافٍ حتى قياس 50k–100k | قوي للكثافة | أقوى سقف |
| WebSocket maturity | ناضج في بيئات TypeScript الشائعة | ناضج | ناضج، والتشخيص أثقل |
| Fault isolation | قوي بالعمليات لا باللغة | قوي | قوي |
| Horizontal scalability | كافٍ ثم يُقاس | مريح أبكر | مريح عند الذروة |
| Event-driven architecture | قوي | قوي | قوي |
| Testability | قوية وسريعة | قوية، مع اختبار عقد بين لغتين | قوية وبطيئة البناء |
| Security | كافية مع العقد الصارم | كافية | أقوى على حدود الذاكرة |
| Memory safety | جمع آلي | جمع آلي | ملكية المترجم |
| Type safety | قوية إذا مُنع التراخي | قوية على الجانبين | قوية |
| Concurrency model | حلقة أحداث تناسب كاتبًا واحدًا لكل مباراة | قنوات تناسب الطوابير | ملكية تناسب النواة، وتبطئ المنتج |
| Operational complexity | الأدنى | متوسط | الأعلى |
| Developer productivity now | الأعلى | متوسط | الأدنى |
| Cursor/AI coding reliability | عالية مع خطر واجهات متخيلة | جيدة مع خطر الحدود | أضعف سرعة وأقوى رفض للمترجم |
| Automated refactoring | مريح داخل لغة واحدة | يحتاج مولّدًا حتى لا ينحرف الجانبان | أصعب عبر WASM والحدود |
| Library ecosystem | الأوسع، والأكثر ضجيجًا | خوادم واتصال قوية، وواجهة أضيق | أنظمة قوية، ومنتج أضيق |
| Observability | ناضجة | ناضجة | ناضجة بتكلفة رموز أعلى |
| CI/CD maturity | عالية | عالية | عالية ومدة البناء أطول |
| Database ecosystem | السواق متوفرة لأي مخزن علائقي يُختار لاحقًا | كذلك | كذلك |
| Long-term maintainability | عالية إذا فُرضت الحدود | عالية إذا مُنعت نسختا القواعد | عالية للنواة، ومكلفة للمنتج الكامل |
| Hiring humans later | الأوسع | وسط للخوادم | الأضيق |
| Infrastructure cost | منخفضة ثم تتناسب مع عدد العمليات | منخفضة، وكفاءة اتصال أفضل لكل عملية | منخفضة تشغيليًا بعد بناء أغلى |
| Evolve without rewrite | استخراج لاحق ممكن | الرجوع عن اللغتين مكلف | البدء هنا يثبّت التكلفة |
| Premature complexity | الأدنى | متوسط | الأعلى |
| Staged growth to very large concurrency | يصل بالقياس ثم بالاستخراج | يصل أبكر للكثافة | أفضل سقف وأغلى بداية |

## 8. Database and state needs / احتياجات البيانات والحالة

التحليل على الاحتياج. الحالة الحالية: PostgreSQL 18 المستقر معتمد في DEC-056. Redis وSQLite كقاعدة منتج ما زالا غير معتمدين.

| Need | Requirement | Initial placement | Must stay isolated even if the machine is shared |
|---|---|---|---|
| Durable relational business data | Transactions, constraints, accounts, tournaments, orders | One transactional store class | Separate credentials per owning domain. DEC-048 |
| Live authoritative game state | Same commit as the outbox and the result | Same transactional store as the game writer's tables | The game credential cannot update rating, ledger, or mind tables |
| Caching | Session facts and flag snapshot. Loss must not lose a result | In-process snapshot while one game process exists | Cache is not authority |
| Event / outbox | Durable with the source commit, then a dispatcher | Rows beside the source aggregate | Consumers do not become the source of truth |
| Object / media storage | Exports, images, later voice | Separate blob class when those features exist. Not on the move path | Not inside the hot game row |
| Search | Rebuildable projection | Absent until the feature exists | Failure closes search. The index is not truth |
| Analytical data later | Warehouse or projections | Not in the first deployment | Never on the accept path |

مشاركة آلة واحدة في البداية مقبولة بين جداول الأعمال وجداول المباراة إذا اختلفت صلاحيات الكتابة. مشاركة الجدول نفسه بين مجالين ممنوعة. مخزن مؤقت منفصل لا يُقدَّم في اليوم الأول لمجرد العادة. يظهر عندما تتعدد عمليات المباراة وتحتاج لقطة أعلام أو حضورًا مشتركًا.

التزام النتيجة والسجل الصادر في الالتزام نفسه يتطلب مخزنًا معاملاتِيًا. هذا وصف لفئة، لا ترشيح منتج بعينه.

## 9. Client strategy / استراتيجية العملاء

أول عميل: Web. الترتيب بعده H/TBD ولم يُخترع هنا.

| Share class | Items |
|---|---|
| Must be shared | Rules behavior for a given `ruleset_id`, versioned commands and events, server authority, security policies, seat and lease concepts |
| Should be shared | Square and sequence validation, error codes of `SubmitMoveCommand.v1`, design tokens where they survive the platform |
| May be shared | SAN formatters, some view-models, local-play rules package |
| Must remain client-specific | Navigation, OS lifecycle, push delivery, packaging, store rules, pointer and touch input |

لا تقنية واجهة واحدة تُفرض على Windows وmacOS وAndroid وiOS. الخلفية ونواة الشطرنج لا تُعاد بناؤها لكل عميل. العميل اللاحق يضيف حزمة في `clients/` ويستهلك العقود. جودة الواجهة الأصلية أولى من تطابق البكسل مع الويب.

## 10. AI and Cursor quality / جودة التطوير عبر Cursor

اللغة الأكثر أمثلة على الإنترنت ليست تلقائيًا الأسهل لوكيل. المعيار هو: هل يستطيع الوكيل أن يخطئ ثم يرى الرفض سريعًا، وهل تستطيع المعمارية أن تمنع الإصلاح الخاطئ من البقاء.

| Question | A | B | C |
|---|---|---|---|
| Reasoning about Chess One boundaries | سهل داخل لغة واحدة، وسهل أيضًا كسر الحدود بصمت | الحد ظاهر، والوكيل قد يكتب القواعد مرتين | الحد ظاهر، والوكيل يتعثر قبل بلوغ القاعدة |
| Compiler / type-check feedback | سريع | سريع على الجانبين | أدق، وأبطأ |
| Deterministic format / lint | متاح ويجب تثبيته لاحقًا بأداة واحدة | `gofmt` حتمي، والواجهة تحتاج أداة ثانية | أداة تنسيق حتمية، ومدة أطول |
| Test ergonomics | الأفضل لدورات القواعد القصيرة | جيد مع طبقة عقد | جيد وثقيل |
| Refactoring safety | عالية داخل الحزمة | عالية إذا فشل البناء عند انحراف المولّد | عالية داخل Rust، ضعيفة عبر WASM إن غابت المتجهات |
| Ecosystem ambiguity | عالية: أطر ويب كثيرة ومتشابهة | متوسطة | متوسطة داخل اللغة، وعالية في ربط WASM |
| Hallucinated APIs | الأعلى احتمالًا | أقل في المكتبة القياسية | شائع في أنماط الاقتراض |
| Automatic architecture enforcement | فحص استيراد لاحق، واللغة لا تكفي | مولّد العقود زائد فحص الاستيراد | المترجم يغلق الملكية لا اتجاه المجالات |

التقليل العملي، أيًا كان المرشح الذي يُعتمد لاحقًا: عقد النقلة مغلق، والمعرّف `FIDE-E01-2023` بيانات، وفحص الحدود في المستودع، ومنع إطار واجهة صامت.

## 11. Engineering recommendation / التوصية الهندسية

**Recommended option:** Candidate A، مع شكل القسم 2: لغة TypeScript واحدة، وعمليات منفصلة للمباراة الحية ولعامل المحرك ولعامل التحليل وللسجل الصادر، ووحدات المنصة الأخرى منطقية داخل عملية منصة ذات حدود. وقت التحليل كانت الواجهة وقاعدة البيانات والمخزن المؤقت غير مختارة. بعد DEC-056: Next.js 16 وReact 19 وPostgreSQL 18 معتمدة، والمخزن المؤقت الخارجي ما زال غير معتمد.

**Runner-up:** Candidate B، كاستخراج لاحق لعملية المباراة الحية فقط، عندما يفشل قياس الساعة أو تكلفة الاتصال على المرشح A في مرحلة 50k–100k أو بعدها.

**Why:** قيد Chess One في البداية صحة القواعد وعزل الأعطال وسرعة تصحيح الوكيل، لا كثافة مليون اتصال. المرشح A يعطي نسخة قواعد واحدة وأقصر حلقة اختبار، والعزل المطلوب عمليات لا لغة. المرشح C أقوى سقفًا وأغلى انطلاقًا، ومكسبه الأمني لا يغلق الغش الخارجي. المرشح B مكسبه حقيقي ومتأخر عن الحاجة المقاسة.

**What would make the recommendation change:**

- قياس يظهر أن كنس الساعة أو ذاكرة الاتصالات على بيئة TypeScript تكسر عدالة الساعة قبل أن يكفي التقسيم الأفقي.
- ظهور نسخة قواعد ثانية فعلية. عندها تُوقف النسخة الثانية، وقد ينتقل الحكم إلى نواة واحدة حتى لو كانت Rust.
- قيد توظيف بشري لاحق يغلب خوادم Go على منتج TypeScript.
- قرار مالك صريح يسمّي لغة بحالة A. هذا حدث في DEC-056 للمرشح A.

**Reversible decisions:** إطار الواجهة قبل بناء الشاشات، منتج المخزن العلائقي داخل فئته، منتج المخزن المؤقت، مزود الاستضافة، لغة العمال، استخراج عملية المباراة لاحقًا مع بقاء المتجهات الذهبية.

**Expensive to reverse:** نسختان مكتوبتان يدويًا من القواعد، خدمات مصغّرة لكل مجال مع معاملات موزعة على مسار النقلة، ساعة يملكها العميل، SAN كسلطة النقلة، محرك تحليل داخل عميل الويب التنافسي، فرض واجهة واحدة على كل الأنظمة.

Candidate C يبقى مسار التطور لنواة القواعد أو لعامل البحث إذا فرض القياس أو مشاركة WASM ذلك. ليس انطلاقة اليوم الأول.
