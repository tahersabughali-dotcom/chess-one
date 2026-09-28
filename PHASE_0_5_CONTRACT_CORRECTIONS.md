# Phase 0.5 Contract Corrections / تصحيحات العقود — المرحلة 0.5

**Status / الحالة:** Binding specification corrections from the owner directive of this batch.  
**ليست قرار حزمة.** لا شيفرة في هذه الدفعة.  
**Precedence / الأسبقية:** هذا الملف مع `CONTRACT_CATALOG_V1.md` أعلى من جمل المرحلة 0 التي كانت تجعل SAN أو UCI مدخلًا مرجعيًا، وأعلى من أي جملة تقول إن DEC-051 ما زال H.

## 1. DEC-051 / بوابة القوانين

| Before | After |
|---|---|
| H. No ruleset date | A. Current baseline `FIDE-E01-2023` |

المصدر الرسمي: FIDE Handbook, Laws of Chess taking effect from 1 January 2023. النص الإنجليزي هو النص الأصيل، اعتُمد في 2022-08-07، وبدأ نفاذه في 2023-01-01.  
`https://handbook.fide.com/chapter/e012023`

المعرّف الهندسي `FIDE-E01-2023` قيمة بيانات على المباراة وعلى استدعاء مكتبة القواعد. يُختار من سجل إصدارات. لا يُنثر كنص مقارَن داخل وحدات التصنيف أو الواجهة أو العمال.

قواعد الإصدار:

- مباراة جديدة على خط الأساس الحالي تُنشأ بهذا المعرّف.
- المباراة تحتفظ بالمعرّف الذي لُعبت به.
- أي نص FIDE لاحق، بما فيه مسودات أو وثائق أسئلة وأجوبة بعد 2023، يحتاج معرّفًا جديدًا موثّقًا من مصدر رسمي ومجموعة انحدار خاصة.
- ممنوع إعادة حساب نتيجة أو شرعية مباراة تاريخية بقوانين أحدث.

نص القانون لا يُنسخ إلى المواصفة. قائمة السلوك في `TEST_ARCHITECTURE_AND_GATES_V1.md` القسم 6 تحيل إلى أرقام المواد.

## 2. SubmitMoveCommand.v1 authority / سلطة النقلة

المرحلة 0 سمحت بـ `move_encoding = san | uci` كجسم الأمر. ذلك جعل تدوين العميل مسار سلطة ممكنًا. التصحيح:

| Role | Fields |
|---|---|
| Command authority | `from_square`, `to_square`, and `promotion_piece` when the move promotes |
| Identity authority | Authenticated session + control lease + server-derived game seat |
| Server output | Canonical SAN, and derived UCI only as an emitted encoding |
| Non-authority | `client_san`, `actor_id`, `client_observed_at`, any client position or FEN |

UCI يبقى ترميزًا يولّده الخادم من الحقول الثلاثة للسجل ولعامل المحرك. ليس مدخلًا بديلًا للأمر. بهذا يبقى نموذج السلطة واحدًا.

التبييت: الملك يتحرك مربعين. الأخذ بالتجاوز: المربعان فقط، والمربع المأسور يُشتق من الحالة المرجعية. الترقية الناقصة أو الزائدة: `InvalidState`. الخادم لا يرقّي إلى وزير تلقائيًا.

## 3. Idempotency / تماثل الأثر

`client_command_id` مفتاح داخل `game_id` وللمقعد الذي يقفله الخادم.

البصمة الدلالية: المباراة + مربع المغادرة + مربع الوصول + قطعة الترقية بعد التطبيع.  
خارج البصمة: وقت العميل، SAN العميل، `actor_id`، التسلسل المتوقع، الجلسة، وعقد التحكم.

| Situation | Result |
|---|---|
| Binding decision exists, same fingerprint | Return that decision. `replayed_response = true`. No second move. `Accepted` stays `Accepted` |
| Binding decision exists, different fingerprint | `InvalidCommandIdentity`. No execution |
| `StaleSequence` or `Unauthorized` | No lock on the command id. No write |
| Two identical in-flight commands | Single writer. One binding decision. The other is a replay |

قرار مُلزِم: `Accepted`, `IllegalMove`, `NotYourTurn`, `GameAlreadyFinished`, أو `InvalidState` بعد أن وصل الأمر مكتمل الشكل إلى حكم.  
`StaleSequence` لا يحرق المعرّف، حتى يستطيع العميل إعادة نفس المعرّف بعد المزامنة.

## 4. Authenticated actor / الفاعل المصادَق

`actor_id` القادم من العميل ليس إثباتًا. المقعد يُستنتج من الجلسة وعقد التحكم والمباراة. المعرّف المرسل إما يطابق هذا المقعد أو يُرفض بـ `Unauthorized`. العميل لا يختار المقعد ولا لون القطع كحقل سلطة.

## 5. Clock representation / تمثيل الساعة

قيم الساعة المرجعية أعداد صحيحة بالمللي ثانية. وقت العميل لا يملك الساعة. هذا قيد عقد، مستقل عن لغة التنفيذ، حتى لا يصبح عدد عشري ثنائي مصدر خصم زمني.

## 6. Draw detail / تفصيل التعادل

بعد إغلاق DEC-051، `draw_rule_detail` في `game.finished.v1` يأخذ، لهذا المعرّف فقط، أحد القيم: `stalemate`, `dead_position`, `threefold_claim`, `fifty_move_claim`, `fivefold`, `seventy_five_move`, `timeout_no_mate`, `resign_no_mate_possible`.

التكرار الثلاثي وقاعدة الخمسين مطالبة من صاحب النوبة، وليسا تعادلًا تلقائيًا. التكرار الخماسي وقاعدة الخمس والسبعين تلقائيان. كش مات في نقلة القاعدة الأخيرة يسبق التعادل. سقوط العلم يخسر، إلا إذا لم يكن لدى الخصم سلسلة كش مات ممكنة. الاستقالة تخسر، إلا في تلك الحالة نفسها فتكون تعادلًا.

دقيقتان تُضافان لخصم مطالبة تعادل غير صحيحة حسب المادة 9.5.3. هذا أثر قوانين، وليس مهلة هجر. مهلة الهجر تبقى TBD.

## 7. What this file does not change / ما لا يغيّره هذا الملف

- لا يختار لغة أو إطارًا أو قاعدة بيانات.
- لا يفتح المرحلة 1.
- لا يغيّر DEC-052. حدود MVP تبقى H.
- لا يرقّي توصية التقنية إلى A.
- لا يحذف IDEA-001 حتى IDEA-342.
- لا يجعل Web عميلًا ثانيًا. الويب يبقى أول عميل.
