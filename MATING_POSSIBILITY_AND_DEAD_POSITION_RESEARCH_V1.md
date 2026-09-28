# Mating Possibility and Dead Position Research v1 / بحث إمكانية الكش مات والموضع الميت

**Ruleset / القوانين:** `FIDE-E01-2023`.  
**Articles / المواد:** 1.5, 5.1.2, 5.2.2, 6.9.  
**Status / الحالة:** DEC-062 = A as a prohibition on false draws. DEC-064 = A: `UNKNOWN` is never an official result. The full detector is BLOCKED/PARTIAL.  
**Legal authority / السلطة:** FIDE Handbook chapter E01 effective 2023-01-01. No chess library and no tablebase is a legal source.

## 1. What the articles require / ماذا تتطلب المواد

المواد الثلاثة تستخدم المعيار نفسه: هل توجد أي سلسلة نقلات قانونية ينتج عنها كش مات لملك الخصم. هذا ليس «هل يمكن فرض الفوز»، وليس قائمة قطع قصيرة.

- المادة 5.2.2: إذا لم توجد مثل هذه السلسلة لأي من الطرفين، الموضع ميت والمباراة تعادل فورًا.
- المادة 5.1.2: الاستقالة خسارة، إلا إذا كان الخصم لا يملك أي سلسلة كش مات، فالتعادل.
- المادة 6.9: سقوط العلم خسارة، إلا في الاستثناء نفسه، فالتعادل. المواد التي أنهت المباراة أصلًا تبقى مقدَّمة.

«أي سلسلة قانونية» تشمل نقلات الخصم الضعيفة. وجود كش مات تعاوني (helpmate) يعني أن الموضع ليس ميتًا، حتى لو كان التعادل هو نتيجة اللعب الأمثل.

## 2. Why a material list is false / لماذا القائمة المختصرة كاذبة

| Shortcut | Error |
|---|---|
| King versus king, or king and minor versus king, treated as the whole definition | Misses dead positions that are locked, and also mis-classifies positions that still have a helpmate |
| Two knights called insufficient | A king and two knights against a lone king can reach a checkmate with the lone king's cooperation. The position is not dead. Timeout against that side is a loss if the detector is correct |
| Tablebase draw called dead | Tablebases answer forced result with best play. A forced draw can still contain a helpmate. A tablebase win does prove the position is not dead. A tablebase draw proves nothing about article 5.2.2 |
| Pawn blocked, therefore dead | Often false. A later capture or a king walk may still open a mating net. Proving the negative is the hard problem |

تعادل كاذب من كاشف ناقص غير مقبول (DEC-062).

## 3. Detector contract / عقد الدالة

القيمة الوحيدة التي يجوز أن تُنتج تعادلًا تحت 5.2.2 أو 5.1.2 أو 6.9 هي `PROVEN_DEAD`.

| Return | Meaning | Allowed effect |
|---|---|---|
| `PROVEN_DEAD` | A reviewed proof says no legal series checkmates | Draw, with the matching detail |
| `NOT_DEAD` | At least one legal series to checkmate is known, or mating material and geometry obviously allow it | No dead-position draw. Timeout and resignation stand as losses |
| `UNKNOWN` | The proof is not finished | Unresolved adjudication state `MATING_POSSIBILITY_UNRESOLVED` (DEC-064). No official win, loss, or draw. No `game.finished.v1`, rating, reward, tournament standing, or official career result. The final product adjudication policy is a later gate. This remains GAP-MATE-001 |

`UNKNOWN` لا يتحول إلى تعادل احتياطي، ولا إلى خسارة احتياطية. الجملة الأقدم التي جعلت `UNKNOWN` خسارة مؤقتة مستبدلة بـ DEC-064.

## 4. Partial set that may be proven by hand / المجموعة الجزئية

هذه الأوضاع يجوز أن تدخل `PROVEN_DEAD` بعد إثبات هندسي مكتوب داخل تنفيذ لاحق، لأن صورة الكش مات غير موجودة أصلًا:

- ملك ضد ملك.
- ملك وفيل واحد ضد ملك وحيد.
- ملك وحصان واحد ضد ملك وحيد.

التناظر مشمول: القطعة الزائدة قد تكون عند أي طرف، والطرف الآخر ملك فقط.

خارج هذه المجموعة، العائد الافتراضي `UNKNOWN` أو `NOT_DEAD` إذا عُرف مسار كش مات. لا تعميم على «كل فيل من لون واحد» ولا على «كل حصانين» حتى يُكتب الإثبات. الحصانان ضد الملك `NOT_DEAD` لأن صورة الكش مات موجودة بالتعاون، وهذا يكفي لإخراجهما من الموضع الميت. هذا تفسير هندسي لنص «أي سلسلة»، وهو مثبّت هنا كسلوك `FIDE-E01-2023` داخل Chess One. إذا صدر تفسير رسمي لاحق يناقضه، فذلك إصدار قوانين جديد لا إعادة قراءة للمباريات القديمة.

الأوضاع ذات البيدق، أو ذات الوزير أو الرخ أو فيلين مختلفي اللون مع ملك وحيد، ليست في مجموعة الإثبات اليدوي الأولى. كثير منها `NOT_DEAD`. المقفل منها `UNKNOWN`.

## 5. Risk / الخطر

| Risk | Direction | Policy |
|---|---|---|
| False draw | Detector says dead while a mate exists | Forbidden |
| False result on time or resignation | Detector says unknown while the position may be dead | GAP-MATE-001. Phase 1 code holds `MATING_POSSIBILITY_UNRESOLVED` and publishes no official result |
| Tablebase false dead | Forced draw treated as 5.2.2 | Forbidden use |
| 75-move interaction | A theoretical mate exists only after the 75-move draw would already have ended the game | GAP-MATE-002. Unknown. The partial set above does not depend on this question because those positions have no mate image at all |

## 6. Algorithmic difficulty / صعوبة الخوارزمية

إثبات عدم وجود أي سلسلة يعني إثبات عدم الوصول إلى أي موضع كش مات في بيان اللعبة القانوني، مع حقوق التبييت والأخذ بالتجاوز وتاريخ النقلة لأنهما يغيّران القانونية. فضاء الحالات أكبر من أن يُغلق بالتخمين. التعداد الراجع من مواضع الكش مات ممكن نظريًا على مجموعات مادة صغيرة، وهو غير مُسلَّم به هنا كحل جاهز.

## 7. Verification strategy / استراتيجية التحقق

منفصلة عن كود المنتج، وتُفتح فقط بعد قرار ترخيص إذا دخلت أداة خارجية:

1. إثبات يدوي للمجموعة الجزئية في القسم 4، مع اختبارات تطفر الموضع بإضافة قطعة تكفي للكش مات وتتوقع `NOT_DEAD`.
2. اختبارات سلبية: ملك وحصانان، ملك ووزير، ملك وبيدق غير مقفل، كلها يجب ألا تعيد `PROVEN_DEAD`.
3. لا اعتماد على Perft. Perft يعد النقلات ولا يثبت الموت.
4. مقارنة مع تطبيق مستقل ممنوعة حتى تُقرأ رخصته. الناتج حتى ذلك الحين ليس سلطة.
5. جداول النهايات، إن دُرست لاحقًا، تُستخدم فقط كدليل `NOT_DEAD` عند وجود فوز مفروض. لا تُستخدم لإعلان الموت. رخصة كود الجداول جزء من بوابة الترخيص.
6. لا يُوسَّع القسم 4 بصمت أثناء التنفيذ. توسيع `PROVEN_DEAD` يحتاج إثباتًا ملحقًا بهذه الوثيقة أو إصدارًا لاحقًا منها.

## 8. Unresolved / غير المحسوم

- GAP-MATE-001: سياسة الحسم عند `UNKNOWN`. حتى تُقرر، الحالة غير محسومة ولا نتيجة رسمية.
- GAP-MATE-002: تقاطع المادة 5.2.2 مع المادتين 9.6.1 و9.6.2.
- GAP-MATE-003: إثبات هندسي لأساقفة من لون واحد ضد ملك وحيد، غير داخل في المجموعة الجزئية بعد.
- GAP-MATE-004: المادتان 5.1.2 و6.9 تسألان سؤالًا من طرف واحد: هل يستطيع هذا الخصم أن يكش مات. الدالة في القسم 3 تحكم على الموضع كله. كل موضع `PROVEN_DEAD` انتهى أصلًا بالمادة 5.2.2، فلا يصل إليه أمر استقالة ولا سقوط علم. لذلك `resign_no_mate_possible` و`timeout_no_mate` يحتاجان دالة من طرف واحد لها إثبات ومراجعة. حتى ذلك الحين، أي حالة لا تثبت فيها `NOT_DEAD` تبقى `UNKNOWN` تحت DEC-064.
- الأوضاع المقفلة ذات البيادق: BLOCKED كفئة، بلا خوارزمية مدعاة.
