# Chess One Online Play Policy v1 / سياسة اللعب الشبكي — الإصدار 1

**Decision / القرار:** DEC-060 = A.  
**Rule / القاعدة:** ما يلي سياسة Chess One. ليس مادة في قوانين FIDE، ولا يُوسَم كقاعدة FIDE.  
**Numbers / الأرقام:** حيث لا يوجد قرار، القيمة TBD وقابلة للتهيئة. لا رقم مخترع.

مصدر سلوك الرقعة يبقى `FIDE-E01-2023` عبر مكتبة القواعد. هذه الوثيقة تغطي ما تفعله الشبكة والأجهزة والخادم حول المباراة.

| Topic | Policy | Number | Relation to FIDE |
|---|---|---|---|
| Network disconnect | The server clock keeps running. The client enters the reconnect machine. No local official result | None | Not a FIDE article. Clock authority is DEC-042 plus the ordering document |
| Browser refresh | Same as disconnect. Refresh does not pause the authoritative clock | None | Not FIDE |
| Mobile background | Same as disconnect. Backgrounding the app does not pause the server clock | None | Not FIDE |
| Abandonment | A later configurable threshold may end a game for abandonment. Until an owner sets it, no automatic abandonment loss exists | TBD | Not the FIDE default-time article. Article 6.7 is an event arbiter rule and is not imported as a number |
| Reconnect | Resync from server state and sequence. Client state does not overwrite the server | None | Not FIDE |
| Multiple devices | One active controller per player in a competitive game. Other devices are view-only | None | DEC-043. Not FIDE |
| Control takeover | If later enabled: verify session, issue a new lease, revoke the old lease, reject old commands, audit, resync | No timeout number | DEC-043. Not FIDE |
| Premove | Not a rules feature in this baseline. A premove must not be stored as an applied move. Any future premove becomes an ordinary command only when it is that player's turn and is then judged by the move contract | TBD whether the product will offer it | Not FIDE |
| Lag compensation | Not approved. Time before Chess One receipt counts as the player's time. No offset, no forgiveness window | TBD as a future policy | Not FIDE |
| Spectator delay | Competitive broadcast is not opened by this policy. UC-GM-08 remains C. Engine evaluation is not part of the player move event | Delay number TBD if broadcast is later approved | Not FIDE |
| Abort / no-start | No numeric no-show loss is approved. Creating a game and starting clocks are live-game operations. An unstarted game has no flag | TBD | FIDE article 6.7 is arbiter/event procedure and stays in class D of the rules pack |
| Server outage | While the authoritative writer is down, it cannot award a flag for time it could not measure. Recovery continues from the last committed clock and sequence. Clients must not invent an official result during the outage | None | Chess One failure policy, not FIDE |

فصل الاتصال أثناء فحص مطالبة تعادل لا يمنح الإيقاف المادي المذكور في قاعة اللعب. أثر الدقيقتين عند مطالبة خاطئة قاعدة FIDE مُثبَّتة في عقد المطالبة، وليست بندًا من هذه السياسة.

اللعب المحلي بلا اتصال يبقى خارج النتيجة الرسمية (DEC-044). هذه السياسة لا تحوّله إلى مباراة خادمية.
