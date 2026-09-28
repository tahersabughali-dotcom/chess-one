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
*Later correction (Phase 1 Batch 6, LIVE-CONTRACT-001):* for 5.2.2 this is unchanged. For 5.1.2 and 6.9 the draw comes from the one-sided `PROVEN_CANNOT_MATE` of section 9, a different predicate. The sentence above is kept as the original wording.

| Return | Meaning | Allowed effect |
|---|---|---|
| `PROVEN_DEAD` | A reviewed proof says no legal series checkmates | Draw, with the matching detail |
| `NOT_DEAD` | At least one legal series to checkmate is known, or mating material and geometry obviously allow it | No dead-position draw. Timeout and resignation stand as losses. *Superseded on this last sentence by LIVE-CONTRACT-001 (section 9): timeout and resignation use the opponent's one-sided capability, not whole-position `NOT_DEAD`* |
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
  *Later status (Phase 1 Batch 6):* split into GAP-MATE-004a, the reviewed classes of section 9, RESOLVED, and GAP-MATE-004b, a general one-sided algorithm, OPEN. See section 9.6.
- الأوضاع المقفلة ذات البيادق: BLOCKED كفئة، بلا خوارزمية مدعاة.

## 9. One-sided mating capability (Phase 1 Batch 6) / قدرة طرف واحد على الكش مات

Added in Phase 1 Batch 6 (2026-09-28). Sections 1 to 8 are unchanged except for the marked later corrections. Section 4, the `PROVEN_DEAD` set, is **not** widened.

### 9.1 Predicate / السؤال

`assessMatingCapability(position, matingColor)` in `@chess-one/chess-rules` returns `PROVEN_CAN_MATE`, `PROVEN_CANNOT_MATE`, or `UNKNOWN`. It asks: does at least one possible series of legal moves exist, with both sides' moves chosen freely (cooperatively), after which `matingColor` has checkmated the other king? It is existential. It is not forced mate, best play, an evaluation, or a probability.

It differs from the whole-position detector of section 3, which asks whether *either* side can mate. Articles 5.1.2 and 6.9 ask about the opponent of the resigning or flagging player only (GAP-MATE-004). Whole-position `NOT_DEAD` is never used to adjudicate time or resignation. The relation that does hold, and is tested (TST-RULE-CAP-012): `PROVEN_DEAD` implies `PROVEN_CANNOT_MATE` for both colours.

The answer depends on the position alone: the placement, side to move, castling rights, and en passant availability that decide which moves are legal (Article 3.10.1, through Articles 3.1 to 3.9). Repetition history, fivefold repetition (9.6.1), the halfmove clock, and the seventy-five-move rule (9.6.2) end an ongoing game. They do not change whether a series of legal moves reaching checkmate exists, so they are not inputs and never block a witness (Batch 6.1 correction). GAP-MATE-002, the interaction of 5.2.2 with 9.6, concerns the dead-position draw and is unaffected.

*Superseded wording (Batch 6), withdrawn by Batch 6.1:* the first Batch 6 text took an optional `history` argument and refused witness lines that would reach a fivefold repetition or pass the seventy-five-move limit.

### 9.2 Classes / الفئات

Both a false `PROVEN_CAN_MATE` (an undeserved loss) and a false `PROVEN_CANNOT_MATE` (an undeserved draw) are forbidden. A class gets a proven answer only with the proof below. There is no material table.

| Answer | Class | Proof |
|---|---|---|
| `PROVEN_CANNOT_MATE` | `matingColor` owns only its king, whatever the opponent owns | A mate needs the mated king in check. A king never gives check, because two kings are never adjacent in a legal position. With no pawn, `matingColor` can never gain material, since promotion is the only way. So this holds in every reachable position. |
| `PROVEN_CANNOT_MATE` | King and one bishop, or king and one knight, against a lone king (for the minor-piece side) | No pawn exists, so neither side gains material. Every reachable position is this material or king against king. Geometric argument: a mated lone king in a corner has two same-coloured neighbours and one diagonal neighbour of the other colour. The attacking king cannot cover both same-coloured squares, because the only square next to both is next to the lone king. A bishop covers one colour. When it gives check it covers the diagonal square but neither of the other two. A checking knight covers none of them. Edge and open squares have more flight squares. **Executable proof:** TST-RULE-CAP-004 and TST-RULE-CAP-005 enumerate every placement of king and piece against a lone king, with the lone king to move and in check. No placement is checkmate. Colour symmetry covers the other colour. TST-RULE-CAP-006 shows that the same enumeration finds a rook mate. |
| `PROVEN_CAN_MATE` | King and queen, king and rook, or king and two knights, against a lone king | Only when a verified witness line exists (9.4). The line is the proof: every move is legal, no position before the last is checkmate or stalemate, and the last position is checkmate won by `matingColor`. |
| `UNKNOWN` | Everything else | No proof is claimed. Examples follow in 9.3. |

**Owner decision (Batch 6).** The batch request first listed king and bishop, and king and knight, against a lone king as `PROVEN_CAN_MATE`. That is false: no cooperative mate exists, as the proof above shows. The owner chose `PROVEN_CANNOT_MATE`, backed by the exhaustive in-repo test. These classes never reach live adjudication in practice, because such a position is already `dead_position` under 5.2.2. They are exact at the API level.

### 9.3 Why opponent material and geometry matter / لماذا تهم مادة الخصم

- **Opponent blockers can enable a mate.** King and bishop against king and knight: in `kn6/1B6/1K6/8/8/8/8/8 b - - 0 1` Black is mated, because the black knight blocks b8. King and knight against king and two pawns: in `k1K5/ppN5/8/8/8/8/8/8 b - - 0 1` Black is mated too. So "a single bishop can never mate" is false once the opponent owns material. Every class with opponent material is `UNKNOWN` (TST-RULE-CAP-008).
- **Enough material is not a proof.** In `k7/1Q6/8/8/8/8/8/7K b - - 0 1` Black's only legal move captures the queen. No line exists, and the answer is `UNKNOWN`, not `PROVEN_CAN_MATE` (TST-RULE-CAP-009). A stalemate or a finished position is also `UNKNOWN` unless it is already a mate by `matingColor`.
- **The halfmove clock does not matter.** The same board, side to move, and rights with a halfmove clock of 0, 20, or 149 give the same answer, `PROVEN_CAN_MATE` for king and queen or king and rook (TST-RULE-CAP-010, TST-LIVE-126).
- **Repetition does not matter.** The same position reached again through cycles that reach and pass a fivefold repetition gives the same answer and the same witness as the fresh position (TST-RULE-CAP-011, TST-LIVE-126).

### 9.4 Witness strategy / استراتيجية الشاهد

`findMatingWitness` runs a deterministic, bounded best-first search, internal to chess-rules (`mating-witness.ts`). No tablebase, retrograde analysis, engine, SAT solver, whole-chess brute force, or external library is used.

- **Frames.** The two corners nearest the lone king, each in two orientations. The target pattern is the lone king in the corner, the attacking king a knight's step away, and a queen or rook mating on the edge, or knights on the two squares that form the two-knights mate.
- **Score.** The lone king's distance to the corner, the attacking king's distance to its target, and, for knights, a knight-distance term. The search expands at most 1,500 positions per frame. It skips positions already expanded (by placement, side to move, and rights) and lines where the lone king captures. The halfmove clock bounds nothing.
- **Verification.** Every line found is replayed by `isVerifiedMatingLine` through the public `applyLegalMove` and `evaluateMoveExhaustion` before it counts: every move legal, no checkmate or stalemate before the last position (no move after either), and the last position checkmate won by `matingColor`. Repetition and the halfmove clock are not consulted. A failed or exhausted search returns `null`, and the answer is `UNKNOWN`. The search is not claimed complete, only sound.
- **Measured** on the development machine: about 60 ms for king and queen, 36 ms for king and rook, and 180 to 300 ms for king and two knights per position. TST-RULE-CAP-021 (150 seeded king-and-major positions) found a line every time except in terminal or forced-capture positions. TST-RULE-CAP-022 (a fixed seeded sample of two-knights positions) found one for every non-terminal position.

### 9.5 The mandatory asymmetric pair / الزوج غير المتماثل

King and queen against king (`4k3/8/8/8/8/8/8/3QK3`):

| Who flags | Opponent | Opponent capability | Result |
|---|---|---|---|
| White (queen side) | Black, lone king | `PROVEN_CANNOT_MATE` | Draw `timeout_no_mate` |
| Black (lone king) | White, king and queen | `PROVEN_CAN_MATE` (verified line) | White wins on time |

The whole-position detector answers `UNKNOWN` for this position. That is correct for 5.2.2, but it does not decide 6.9. Tests: TST-RULE-CAP-002 and TST-LIVE-121.

### 9.6 GAP-MATE-004 status / حالة الفجوة

- **GAP-MATE-004a, reviewed classes: RESOLVED.** Adjudication is implemented for the classes of 9.2.
- **GAP-MATE-004b, general one-sided algorithm: OPEN.** Every other position is `UNKNOWN` and stays `MATING_POSSIBILITY_UNRESOLVED` under DEC-064. That covers pawns, any opponent material, bishop pairs, bishop and knight, several pieces, and failed searches. Chess One does **not** claim complete timeout or resignation adjudication. Widening either proven class needs a written proof appended here and an executable test, as section 7 step 6 requires for `PROVEN_DEAD`.

### 9.7 Tests / الاختبارات

TST-RULE-CAP-001 to CAP-013 (unit, in `tests/rules/mating-capability.test.ts`) and CAP-020 to CAP-023 (properties). Live-game adjudication: TST-LIVE-120 to 125 (timeout), 130 to 139 (resignation), and 140 to 141 (properties).

الخلاصة: الإجابة المُثبتة فقط لفئات لها برهان مكتوب أو شاهد مُتحقَّق منه. كل ما عداها `UNKNOWN`، ولا نتيجة رسمية له.
