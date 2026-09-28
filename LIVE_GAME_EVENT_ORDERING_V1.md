# Live Game Event Ordering v1 / ترتيب أحداث المباراة الحية — الإصدار 1

**Decision / القرار:** DEC-061 = A. DEC-063 = A for the clock domain. DEC-064 = A for unresolved mating possibility.  
**Corrects / يصحّح:** any reading of `SubmitMoveCommand.v1` that compared the flag to `applied_at`. The catalog now points here.

## 1. Two clocks / ساعتان

| Clock | Role |
|---|---|
| Server monotonic time | The only clock that measures elapsed thinking time and that decides whether a command met its deadline |
| Wall clock | Audit, logs, and display. It does not decide a flag |

القيم المخزّنة للرصيد أعداد صحيحة بالمللي ثانية. الساعة الرتيبة قد تكون وحدة أدق داخل العملية، والمقارنة تُحوَّل إلى المللي ثانية بلا عدد عشري ثنائي كرصيد.

زمن العميل، بما فيه `client_observed_at`، لا يملك الساعة.

## 2. Receipt and apply / الاستلام والتطبيق

- `received_at`: اللحظة الرتيبة التي دخل فيها الأمر إلى كاتب المباراة الحية المرجعي. تُختم داخل مجال الساعة الرتيبة لعملية الكاتب نفسها، عند المدخل، قبل فحص القواعد وقبل الطابور الداخلي للكاتب.
- `applied_at`: لحظة الالتزام بعد فحص القواعد. زمن التزام وتدقيق فقط. ليس زمن خصم.

### 2.1 Clock domain / مجال الساعة (DEC-063)

- ختم رتيب من عميل الويب مرفوض.
- ختم رتيب من عملية المدخل (edge) لا يُقارن مباشرة بساعة عملية المباراة الحية. عمليتان مختلفتان لهما ساعتان رتيبتان غير قابلتين للمقارنة.
- بروتوكول موثوق لنقل زمن الاستلام بين العمليات قد يُصمم لاحقًا. غير معتمد الآن.
- ساعة الحائط يجوز أن تنتقل بين العمليات للتدقيق والسجلات. لا تحسم سقوط العلم.
- لذلك، تأخير المدخل قبل وصول الأمر إلى الكاتب يُحسب ضمن زمن اللاعب في خط الأساس الحالي، مثل تأخير الشبكة. تعويضه جزء من سياسة تعويض التأخير غير المعتمدة.

تأخير الفحص والكتابة بعد استلام وقع قبل الموعد لا يُخصم من اللاعب. اللاعب لا يُعاقب لأن طابور Chess One أو مكتبة القواعد اشتغلت بعد أن وصل أمره في الوقت.

التأخير قبل أن يملك Chess One الأمر (شبكة اللاعب وجهازه) يبقى وقت اللاعب. تعويض هذا التأخير سياسة مستقلة وغير معتمدة (Lag compensation = TBD). لا رقم تعويض في هذه الوثيقة.

## 3. Deadline race / سباق الموعد

لكل أمر نقلة أو مطالبة أو استقالة أو عرض وصل إلى الكاتب:

1. ثبّت `received_at`.
2. احسب الموعد من رصيد المقعد عند بدء النوبة زائد الزمن الرتيب المنقضي حتى الاستلام. الزمن بعد الاستلام لا يدخل.
3. إذا كان `received_at` بعد الموعد: لا تُطبَّق النقلة ولا المطالبة كحركة. نتيجة العلم حسب المادة 6.9 ووثيقة إمكانية الكش مات: `NOT_DEAD` خسارة بالوقت، وإثبات أن الخصم لا يستطيع الكش مات تعادل `timeout_no_mate` (فحص من طرف واحد، GAP-MATE-004). إن أعادت الدالة `UNKNOWN` فالحالة `MATING_POSSIBILITY_UNRESOLVED`: لا فوز ولا خسارة ولا تعادل رسمي، ولا `game.finished.v1` (DEC-064). سياسة الحسم النهائية بوابة لاحقة.  
   *Superseded wording (Phase 0), on "`NOT_DEAD` → loss on time":* **later approved correction LIVE-CONTRACT-001 (RESOLVED, Phase 1 Batch 6)**, normative text in `CONTRACT_CATALOG_V1.md` section 10.5. The flag is decided by the flagged side's opponent's one-sided capability, `assessMatingCapability(position, opponent)`: `PROVEN_CAN_MATE` is a loss on time for the flagged side, `PROVEN_CANNOT_MATE` is a draw `timeout_no_mate`, and `UNKNOWN` stays `MATING_POSSIBILITY_UNRESOLVED` with no result and no event. The writer's own deadline check uses the same rule. A resolved flag emits `game.finished.v1` once, in the transition that commits it. / الحسم حسب قدرة الخصم وحده.
4. إذا كان `received_at` في الموعد أو قبله: الأمر في الوقت. أكمل الفحص حتى لو تجاوزت ساعة الحائط الموعد أثناء الفحص. الخصم هو الفرق حتى `received_at` فقط.
5. نقلة في الوقت تنهي المباراة بكش مات: السبب `checkmate` (المادة 5.1.1)، لا العلم.
6. نقلة في الوقت تُنتج باتًا: `stalemate`.
7. نقلة في الوقت تكمل التكرار الخماسي أو الخمس والسبعين: التعادل التلقائي، إلا إذا كانت النقلة نفسها كش مات فالكش مات يسبق (المادة 9.6.2).
8. أمر وصل بعد الموعد لا يُسجَّل ككش مات حتى لو كانت المربعات ستكش مات لو وصلت في الوقت.

إذا انتهت المباراة أصلًا بالتزام سابق، الرد `GameAlreadyFinished` ولا تُعاد كتابة النتيجة بسبب علم متأخر.

## 4. Ordering inside one writer / الترتيب داخل الكاتب

كاتب واحد لكل مباراة. الأوامر تُسلسل بترتيب الاستلام عنده. أمران في الوقت لنفس المقعد لا يُطبَّقان معًا. الثاني إما إعادة متطابقة أو `NotYourTurn` / `StaleSequence` / `InvalidCommandIdentity` حسب عقد الأمر.

انهيار العملية ليس علمًا. هذا البند سياسة Chess One في `CHESS_ONE_ONLINE_PLAY_POLICY_V1.md`: أثناء غياب الكاتب لا يُحتسب زمن العلم، والاستئناف من آخر رصيد ملتزم.

## 5. Draw-claim time / وقت مطالبة التعادل

المطالبة تُفحص على الخادم بلا إيقاف ساعة بسبب الفصل. مطالبة خاطئة تضيف 120000 مللي ثانية لرصيد الخصم. إذا سُمّيت نقلة مقصودة قانونية، تُطبَّق بعد تسجيل الخطأ، وخصم ساعتها حتى زمن استلام أمر المطالبة. نقلة مقصودة غير قانونية لا تُطبَّق.

## 6. Tests / الاختبارات

`TST-CLOCK` في دفتر الذهب وملحق الاختبار يغطي: استلام قبل الموعد مع تطبيق متأخر، استلام بعد الموعد، كش مات في الوقت مقابل علم، رفض ختم العميل، ورفض ختم رتيب قادم من عملية المدخل. لا اختبار لتعويض تأخير غير معتمد.
