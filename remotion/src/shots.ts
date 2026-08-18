// Render entry for the PROMO SHOTS. Separate from index.ts for the same
// reason episodes.ts is: index.ts pulls the promo, the promo pulls theme.ts,
// and theme.ts fetches Google Fonts at module scope — which dies behind a
// proxy headless Chromium does not trust. The shots load their fonts from
// remotion/public/fonts instead.
import { registerRoot } from 'remotion';
import { ShotsRoot } from './shots/ShotsRoot';

registerRoot(ShotsRoot);
