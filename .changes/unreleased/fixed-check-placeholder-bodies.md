---
kind: fixed
summary: check now rejects placeholder fragment bodies
---

`parseFragment` now rejects a fragment whose body is still the configured `fragmentBodyPlaceholder` (the `note` scaffold text) and rejects a summary ending in `.` (the renderer emits `**{summary}:**`, so a trailing period rendered `**Summary.:**`). A consumer repo nearly shipped 28/124 placeholder bodies into release notes and a Discord announcement before this guard existed; `check` and `cut` both now refuse to publish an untouched scaffold.
