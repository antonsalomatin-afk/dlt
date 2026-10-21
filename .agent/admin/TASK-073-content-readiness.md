# TASK-073 bilingual reminder content readiness

Owner decision on 2026-10-21: private bot chat; English and Russian in the same question post. Use the existing opted-in 11:00 ICT reminder schedule. No channel setup is required.

Repository inspection of the accepted launch source batches:

| Source batch | Questions | English stems | Russian stems | Image references |
|---|---:|---:|---:|---:|
| `content/imports/launch-20261016-car-candidates.json` | 50 | 50 | 0 | 0 |
| `content/imports/launch-20261016-motorcycle-candidates.json` | 50 | 50 | 0 | 0 |

This is a local source-artifact inventory, not a new production database observation. TASK-071 records publication of these English starter batches. No content, translations, verification decisions or production data changed in TASK-073.

The implementation must retain the existing generic localized invitation when the saved daily question lacks Russian text. It must not invent a translation, select an unrelated replacement or silently stop an opted-in reminder. Questions without approved images use text-only posts.

To make bilingual question posts useful in production, reviewed Russian stems must be supplied through a separately scoped traceable content update, preserving accepted English wording, question/choice identity and existing presentation snapshots. Existing candidate import/review tools require exact source content and cannot be used as an unrestricted in-place translation editor. Production content changes and deployment remain separate owner approval gates after concrete artifacts and checks are ready.
