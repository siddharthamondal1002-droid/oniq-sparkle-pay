// Render entry point for the EPISODES. See EpisodesRoot.tsx for why this is
// separate from index.ts — in one line: index.ts pulls in the promo, the promo
// pulls in theme.ts, and theme.ts fetches Google Fonts at module scope, which
// fails behind a proxy headless Chromium does not trust.
import { registerRoot } from 'remotion';
import { EpisodesRoot } from './EpisodesRoot';

registerRoot(EpisodesRoot);
