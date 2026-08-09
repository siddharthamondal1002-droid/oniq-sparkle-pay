// Render entry point for the RIG PROOF. See RigRoot.tsx for why it is separate
// from index.ts — in one line: index.ts pulls in the promo, the promo pulls in
// theme.ts, and theme.ts fetches Google Fonts at module scope, which fails
// behind a proxy headless Chromium does not trust.
import { registerRoot } from 'remotion';
import { RigRoot } from './rig/RigRoot';

registerRoot(RigRoot);
