# Server-side Firebase route (Lovable Cloud stays the identity)

Build the backend bridge so ONIQ can put files in Firebase Storage and read/write
Firestore documents using the service account it already holds — with no Firebase
web app, no Firebase Auth, and no change to how anyone signs in.

## The shape

```text
phone  --(Lovable Cloud session)-->  edge function  --(service account)-->  Firebase
                                     |
                                     +-- checks who you are against Postgres
                                     +-- decides what you may touch
```

Every request is authorised the way the rest of ONIQ already authorises requests:
the caller's own token is re-derived server-side and their user id decides the
path they may read or write. Firebase never sees an end user, so Firestore and
Storage rules are not a second authorisation system to keep in sync — the
existing 242 policies stay the only authority.

## What gets built

1. **`_shared/firebaseServer.ts`** — one place that knows how to talk to Firebase
   with the existing service-account token from `googleAuth.ts`:
   - Firestore REST: get / set / update / delete / query a document path.
   - Storage: upload bytes, and mint a short-lived read URL for an object.
   - Value conversion between plain JSON and Firestore's typed field format,
     with tests for round-tripping.
2. **`firebase-bridge` edge function** — the only entry point. Signed-in users
   only. Namespacing is server-computed (`users/{supabase-uid}/...`); a path sent
   by the client is never trusted. Actions: `doc.get`, `doc.set`, `doc.delete`,
   `collection.list`, `file.upload`, `file.url`.
3. **`src/lib/firebaseBridge.ts`** — thin typed client for app screens to call it.
4. **Admin visibility** — extend the existing read-only `/app/admin/firebase`
   screen with a "bridge check" button that round-trips one document and one
   small file, so the wiring can be proven without a console.

## Deliberately out of scope

Chat, calls, wallet and the money paths are untouched. No message or conversation
moves to Firestore in this change — that decision depends on the identity switch
and stays open. Nothing client-side talks to Firebase directly.

## Notes

- Firestore must be provisioned in the Firebase project for the document actions
  to work; the file actions work today because the bucket already exists. The
  bridge reports which of the two is unavailable rather than failing opaquely.
- No secret value is ever returned or logged; failures pass Google's own words
  through, as the weather build established.
