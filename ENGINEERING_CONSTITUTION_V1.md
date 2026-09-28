# Engineering Constitution v1 / دستور الهندسة — الإصدار 1

**Status / الحالة:** DEC-055 = A. Binding for later implementation. This file does not open Phase 1 and does not install anything.  
**الحالة:** ملزم عند البناء لاحقًا. هذه الدفعة لا تنشئ شيفرة.

## 1. Owner principles / مبادئ المالك

| Principle | Meaning in Chess One |
|---|---|
| Modern stable technology | The critical path uses supported stable releases. Beta, RC, canary, nightly, and experimental builds are outside that path |
| Security first | Session, authorization, secrets, and audit are part of the design of a feature before it is exposed |
| Minimum necessary code | The smallest code that is correct, clear, and maintainable. Clever compression is rejected |
| Clarity over terseness | In chess rules, clock, security, authorization, money, rating, and contracts, a longer clear function is preferred to a shorter obscure one |
| Small cohesive modules | One responsibility and a small public API. No god file and no god class |
| Dependency minimization | A platform capability is used before a package. Every dependency needs a written reason |
| No hidden magic | No casual global mutable state, no hidden cross-domain side effect, no hidden database write, no import that crosses a domain boundary |
| Measured performance | No claim of perfect speed. Judgment uses benchmarks, profiling, load tests, soak tests, and p95/p99 |
| Replaceability | A non-critical component sits behind a contract so it can be replaced |
| Observability by design | Structured logs, stable error ids, metrics, and trace boundaries. Observability is not a synchronous dependency of move acceptance |
| Human maintainability | A later programmer locates a fault from the module name, the contract id, and the test id |

## 2. Soft review budgets / ميزانيات مراجعة لينة

هذه محفزات مراجعة، وليست حدود أسطر تُقسَّم الملفات لأجلها.

| Trigger | What the reviewer asks |
|---|---|
| Oversized module | Has this file become a god file? Split only along a real responsibility |
| High complexity | Should this function be named steps a reader can follow? |
| Deep nesting | Can a guard clause flatten the path without hiding a rule? |
| Duplication | Is the same business rule copied? One module should own it |
| Large public API | Are callers using internals that should stay private? |
| Too many dependencies | Which dependency has no written reason? |

تقسيم ملف فقط ليصغر عدده ممنوع. الإبقاء على ملف كبير بعد ظهور المحفز، بلا مراجعة، ممنوع أيضًا.

## 3. Code quality rules / قواعد الجودة

تُفرض لاحقًا بأدوات الفحص، لا في هذه الدفعة.

- TypeScript في أصرح إعداد عملي: بلا `any` ضمني.
- بلا تحويل نوع غير مفحوص.
- بلا `ts-ignore` إلا بسبب استثنائي مكتوب بجانب السطر، مع معرّف متابعة.
- بلا `catch` صامت وبلا ابتلاع للخطأ.
- أخطاء المجال صريحة، ولها رموز مستقرة تطابق رموز العقود (`IllegalMove`, `StaleSequence`, `InvalidCommandIdentity`, وغيرها).
- الاعتمادية لها سبب مكتوب قبل إضافتها.
- العبور بين الوحدات عبر الواجهة العامة فقط.
- قاعدة العمل تعيش في مالكها. القواعد لا تُنسخ داخل الواجهة أو التصنيف.
- لا درج أدوات عام يتجمع فيه كل شيء.
- لا تبعية دائرية.
- لا حالة عامة قابلة للتغيير كمخزن حقيقة.
- اختبارات القواعد الحرجة بجانب مكتبة القواعد، ومرتبطة بـ `DEC` و`FR` و`RULE` و`TST`.
- بعد كل دفعة تنفيذ لاحقة: تبسيط ما اتسع بلا داعٍ.

## 4. Module and repository boundaries / الحدود

المستودع الواحد (DEC-058) عند فتح السقالة لاحقًا:

```text
docs/
contracts/
domain/chess-rules/
domain/game-values/
server/edge/
server/live-game/
server/platform/
server/workers/
clients/web/
tests/
tooling/
```

Windows وmacOS وAndroid وiOS تبقى في الوثائق حتى تُفتح مرحلتها. لا مجلدات عملاء فارغة للزينة.

فحوص الحدود المستقبلية، ضمن `tests/`، ترفض:

- استيراد العميل لداخل الخادم.
- استيراد المباراة الحية للذكاء أو المتجر أو التحليل.
- استيراد مجال لتخزين مجال آخر.
- استيراد العقود للخادم أو العميل.
- استيراد مكتبة القواعد للشبكة أو قاعدة البيانات أو سلطة الساعة.

`server/platform` يضم الوحدات المنطقية غير الحرجة (الهوية، المطابقة، التصنيف كمستهلك، السجل). هي ليست خدمات مصغّرة.

## 5. Dependency and license gate / بوابة الاعتماد والترخيص

قبل استخدام chess.js أو chessops أو python-chess أو Stockfish أو أي مكتبة شطرنج أو محرك:

| Question | Required answer before use |
|---|---|
| License of the exact version | Read from that version's license file |
| Distribution duty | What must ship with a binary or a web bundle |
| Test-only or runtime | Test-only use is still a license question |
| Chess One distribution license | Still an open product/legal decision. Compatibility cannot be declared closed |
| GPL copy into the core | Forbidden until a separate legal decision allows it |

ملاحظة بحث بتاريخ العملة 2026-09-28، وليست إذن استخدام: chess.js يُنشر عادة بتراخيص BSD، وchessops وpython-chess وStockfish تُنشر عادة تحت GPL-3.0. لم يُثبت شيء ولم تُقرأ ملفات التراخيص من سجل الحزم لأن التثبيت ممنوع في هذه الدفعة. أي مكتبة تُستخدم كمرجع اختبار ليست سلطة قانونية. سلطة القوانين تبقى نص FIDE `FIDE-E01-2023`.

## 6. Security development gates / بوابات الأمن

قبل ميزة مكشوفة: مراجعة ضد `SECURITY_THREAT_MODEL_V1.md`.

- ملف تعريف جلسة آمن حيث تُستخدم ملفات التعريف، وليس معرّف الجلسة في الرابط.
- تخطيط CSP وTrusted Types لعميل الويب. React 19.3 يذكر دعم Trusted Types؛ التخطيط مطلوب، والتفعيل التفصيلي عند البناء.
- التحقق من أصل الاتصال اللحظي.
- تفويض خادمي لكل أمر حسّاس.
- تحديد معدل.
- فحص الأسرار.
- فحص ثغرات الاعتماديات.
- SBOM قبل الإنتاج.
- لا سر إنتاج في المستودع أو العميل.
- صلاحيات قاعدة البيانات بالحد الأدنى لكل مجال.
- تدقيق إلحقي.
- التحقق من شكل المدخل.
- عزل الملفات المرفوعة عن عملية المباراة.
- لا بيانات اعتماد قاعدة للوكيل الذكي.

لا ضبط أمني اختياري بعيد يوقف مسار الطبقة 0 بشكل متزامن. فشل الملاحظة أو فحص الثغرات خارج الطلب لا يوقف نقلة وصلت إلى الكاتب.

## 7. Observability / الملاحظة

السجلات JSON منظّمة، وفيها معرّف خطأ ثابت ومعرّف مباراة ومعرّف أمر عند وجودهما، بلا بريد ولا أسرار. المقاييس والتتبع على حدود العمليات. إسقاطها لا يعيد فتح التزام النقلة.

## 8. What this constitution refuses / ما لا يفعله الدستور

- لا يفتح المرحلة 1.
- لا يثبّت رقم تصحيح كجزء من المعمارية.
- لا يختار مزود سحابة.
- لا يدّعي أن الأداء سيبلغ رقمًا قبل القياس.
