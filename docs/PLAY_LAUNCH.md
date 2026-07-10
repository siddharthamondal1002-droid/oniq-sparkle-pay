# ONIQ — Play Store Launch (phone-only)

You have no laptop. Everything below is doable from your phone using the GitHub app / browser + Play Console.

## What we built

A thin Capacitor Android wrapper that loads `https://oniqhub.com` inside a native WebView. The Play Store app itself is basically a shell — every code change you ship on Lovable is instantly live in the installed app, no store review needed for content updates. Only wrapper-level changes (native perms, icon, package name) require a new AAB.

## One-time setup

1. **Sync Lovable → GitHub.** In Lovable: Settings → GitHub → Connect repo. Push happens automatically.
2. **Open the repo on GitHub** (mobile browser or GitHub app). Go to **Actions**. If Actions are disabled, tap "I understand my workflows, enable them".

## First build — generates your keystore

Run the workflow once with NO secrets configured:

1. Actions → **Android Build** → **Run workflow** → Run.
2. It will fail on purpose after the "Generate keystore" step. That's expected.
3. Open the failed run → scroll down → **Artifacts** → download **`keystore-SAVE-THIS-ONCE`**.
   - Contains `keystore.jks`, `keystore.jks.base64`, and `credentials.txt`.
   - **SAVE THESE SOMEWHERE SAFE** (personal cloud drive, password manager). If you lose them, you can never update the Play Store listing again — you'd have to publish a new app under a new package name.
4. Add 4 repo secrets. GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `ANDROID_KEYSTORE_BASE64` → paste the whole contents of `keystore.jks.base64` (one long line, no spaces/newlines).
   - `KEYSTORE_PASSWORD` → from `credentials.txt`.
   - `KEY_ALIAS` → `oniq`
   - `KEY_PASSWORD` → same value as `KEYSTORE_PASSWORD` (that's how the generator sets it).

## Every subsequent build

1. Actions → **Android Build** → **Run workflow** → Run.
2. Wait ~5–8 min.
3. Open the run → **Artifacts** → download **`oniq-release-aab`** → unzip → you get `app-release.aab`.

## Uploading to Play Console (phone browser)

Play Console works fine in a mobile browser (use desktop-site view if the mobile UI hides things).

1. play.google.com/console → **Create app** (first time only). App name **ONIQ**, default language, App / Free.
2. Complete these mandatory sections in the left rail (Play won't let you release without them):
   - **App content**: Privacy policy URL → `https://oniqhub.com/privacy`
   - **Data safety**: fill the questionnaire. Key data types we collect: Name, Email, User IDs, Photos, Messages, Payment info. Purpose: App functionality + Account management. Encrypted in transit: yes. User can request deletion: yes (Profile → Danger zone → Delete account).
   - **Content rating**: run the IARC questionnaire — for a chat + payments app you'll land at PEGI 3 / ESRB Everyone.
   - **Target audience**: 18+ (safest — payments involved).
   - **Ads**: No (we don't show ads).
   - **App category**: Social or Communication.
   - **Store listing**: short description ≤ 80 chars, full description ≤ 4000 chars, one 512×512 icon, at least 2 phone screenshots (portrait, 1080×1920 or similar; take from the running site).
3. **Testing → Closed testing → Create track**. Add your tester Google-account emails (they must accept the tester invite link before installing).
4. **Create new release** in the closed track:
   - Upload the `app-release.aab`.
   - Release name auto-fills.
   - Release notes: "Initial closed test build."
   - Save → Review release → **Start rollout to Closed testing**.
5. **Reviewer test credentials** — Play reviewers ask for a working login. Under App content → App access, add:
   - Username: (your test user email)
   - Password: (test password)
   - Instructions: "Sign in with the credentials above. Main flows to test: send a message in Chat, send a payment in Pay, browse the Discover feed."

## Version bumps

Before each new AAB build, bump `versionCode` (integer, must always increase) and `versionName` in `android/app/build.gradle`. Push the change, re-run the workflow.

## Troubleshooting

- **Workflow can't find keystore secrets** → confirm all 4 secret names match exactly, case-sensitive.
- **"Version code X has already been used"** → increment `versionCode` in `android/app/build.gradle`.
- **Play Console rejects the AAB signature** → you re-generated the keystore. You MUST reuse the original one. Restore from your saved backup.
- **Camera / mic doesn't work in the installed app** → make sure `android/app/src/main/AndroidManifest.xml` still has `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` permissions (already added).
