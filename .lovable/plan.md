
# Full-screen Incoming Call Experience

Additive only. The protected call stack (`CallOverlay.tsx`, `GlobalCallHost.tsx`, `SpeakerRouter`, `turn-creds`, `send-push`, signaling) keeps its current behavior; the new screen replaces the visual layer of `GlobalIncomingCall` and adds native full-screen-intent wiring around the existing FCM path.

## Assumptions (state so you can correct)

- The user's "selected ringtone" today = the single ringtone played by `playRingtone()` in `src/lib/callSounds.ts`. There is no per-user picker table yet. I'll read it from the same source; if you actually want a picker + persisted choice, say so and I'll add a `user_call_prefs` table.
- "Message instead" canned replies are localized via existing `dictionaries.ts` (3 defaults + custom text field). Sends as a normal chat message via existing `messages` insert path.
- "Remind me" = decline + insert a row in a new `call_reminders` table; a lightweight in-app checker surfaces due reminders as a toast + tile. No push scheduling (would need cron infra).
- Group "already-on-call" avatars come from `call_logs.callee_ids` / accept broadcasts already flowing on `call:{conversationId}` — read-only, no signaling change.

## Scope

### New files (all additive)
- `src/components/chat/IncomingCallScreen.tsx` — full-screen UI (avatar + pulse, accept/decline, swipe-up gesture, group stack, glass gradient). Consumed by `GlobalIncomingCall` in place of the current inline overlay JSX.
- `src/components/chat/QuickReplySheet.tsx` — bottom sheet with 3 canned replies + custom input; sends message then declines.
- `src/components/chat/RemindMePrompt.tsx` — small confirm + writes to `call_reminders`.
- `src/components/chat/CallReminderWatcher.tsx` — mounted in `_authenticated/app.tsx` next to existing global hosts; polls due reminders, shows toast.
- `src/components/onboarding/FullScreenIntentPrompt.tsx` — one-time prompt after first missed call, deep-links to system settings via a new Capacitor plugin method.

### Minimal edits
- `src/components/chat/GlobalIncomingCall.tsx` — swap inline JSX for `<IncomingCallScreen …/>`; keep subscription, ref logic, accept/decline handlers, `isThreadOpen` suppression, and sound lifecycle **untouched**. Add a 45s auto-dismiss timer that also logs a missed call.
- `src/routes/_authenticated/app.tsx` — mount `CallReminderWatcher` and `FullScreenIntentPrompt` alongside existing hosts.
- Android:
  - `AndroidManifest.xml`: add `USE_FULL_SCREEN_INTENT` permission; declare `IncomingCallActivity` as `showWhenLocked`/`turnScreenOn` transparent activity that immediately routes to the WebView with `oniq_url`.
  - `OniqMessagingService.java`: for `type=incoming_call` data messages, build a notification with `setFullScreenIntent(pendingIntent, true)` + high-priority heads-up fallback with Accept/Decline actions; runtime-check `NotificationManager.canUseFullScreenIntent()` (API 34+) and downgrade cleanly.
  - New `IncomingCallActivity.java` — thin launcher that forwards the deep-link intent to `MainActivity` (`oniq_url=/app/chat/<id>?acceptCall=<callId>&acceptType=<type>`).
  - Extend `SpeakerRouterPlugin.java` (or a new `CallSettingsPlugin`) with `openFullScreenIntentSettings()` — opens `Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`. Read this from web via `@capacitor/core` `registerPlugin`.
- `supabase/functions/send-push/index.ts`: when payload is a ring event, add `type: "incoming_call"` and `callId`, `callType`, `fromName`, `conversationId` to the FCM `data` block so the native service can build the full-screen intent. **Do not** change the WebSocket ring path or add server-side logic — this is just extra fields.

### Migration (new file)
```sql
-- call_reminders: personal reminders to call someone back
CREATE TABLE public.call_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  peer_name text,
  remind_at timestamptz NOT NULL,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_reminders TO authenticated;
GRANT ALL ON public.call_reminders TO service_role;
ALTER TABLE public.call_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reminders" ON public.call_reminders FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Missed calls reuse existing call_logs (status = 'missed'); no new table.
-- Add index used by the 45s auto-dismiss missed-call insert.
CREATE INDEX IF NOT EXISTS call_logs_callee_missed_idx
  ON public.call_logs (conversation_id, created_at DESC);
```

## Call-path invariants preserved (will re-verify)
1. `startCall` / `call_logs` insert unchanged — `callee_ids` populated by existing code.
2. Ring broadcasts + push still target real peer list; `send-push` only gains extra `data` fields.
3. No autoStart or deep-link change: native full-screen intent still lands on the existing `?acceptCall=…` URL that `GlobalIncomingCall` already handles.
4. Sound lifecycle: `IncomingCallScreen` never calls `stopAllCallSounds` directly — that stays in `GlobalIncomingCall`'s existing effect, plus a top-level `useEffect` cleanup on unmount.

## Out of scope (call out — will not touch)
CallOverlay signaling, PeerPool, wallet, chat message pipeline, ting/smart-scout/ride-genie, miniapps, mappls-geo, `_authenticated/route.tsx`, `auth.tsx`.

## Delivery order
1. Migration → 2. Native (manifest + service + activity + plugin) → 3. Web components → 4. Wire into `GlobalIncomingCall` + `app.tsx` → 5. Verify build + state call-invariant check.

Approve and I'll build it in that order.
