# ONIQ Task Roadmap

- [x] Fix preview build errors in `supabase/functions/story-still/index.ts` (`sleep` return type)
- [x] Make the checkpoint refusal deterministic so a failing frame is submitted once, not three times
- [x] Put the in-house still stage inside the spend ledger (reserve before dispatch, settle both terminal outcomes)
- [ ] BLOCKED: repair the worker's checkpoint refusal. `oniq-gpu-worker` answers 404 to the credential this
      project holds (Git and the repository API), so the worker source, its image publication workflow and
      its endpoint template cannot be reached from here. Nothing about the five ltxcaps refusals can be
      diagnosed or fixed without it.
- [ ] BLOCKED on the above: the one-PNG-to-one-clip proof (bytes, storage key, GPU job, aliveness, settled
      ledger). Held deliberately — a diagnostic attempt now would meet the same baked image and refuse again.
