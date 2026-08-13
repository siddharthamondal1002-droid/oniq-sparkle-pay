import { Composition } from 'remotion';
import { Episode1 } from './ep1/Episode1';
import { EP1_TOTAL } from './ep1/manifest';
import { Episode2 } from './ep2/Episode2';
import { EP2_TOTAL } from './ep2/manifest';
import { Episode3 } from './ep3/Episode3';
import { EP3_TOTAL } from './ep3/manifest';
import { Episode4 } from './ep4/Episode4';
import { EP4_TOTAL } from './ep4/manifest';

/**
 * The episodes, and ONLY the episodes. Entry point: src/episodes.ts.
 *
 * This exists because of one import. `Root.tsx` also registers the promo, the
 * promo is built from `theme.ts`, and theme.ts calls `@remotion/google-fonts`
 * loadFont AT MODULE SCOPE — so merely including the promo in a bundle makes
 * headless Chromium fetch Space Grotesk and DM Sans from fonts.gstatic.com the
 * moment the composition is evaluated. Behind this container's proxy that dies
 * with ERR_CERT_AUTHORITY_INVALID, and `selectComposition` throws a bare
 * "NetworkError: A network error occurred" before a single frame renders. It
 * reads like a Remotion fault and is not one.
 *
 * The episodes need no remote font — they are photographs and paintings with a
 * voice over them, and there is not one character of text in any of the three.
 * So the fix is to not bundle the promo alongside them, rather than to weaken
 * certificate verification, which would be trading a real security control for
 * a font nothing in this bundle draws.
 *
 * `Root.tsx` still registers all four for Remotion Studio, where a working
 * network makes the promo previewable. The render scripts use this one.
 */
export const EpisodesRoot: React.FC = () => (
  <>
    <Composition
      id="ep1"
      component={Episode1}
      durationInFrames={EP1_TOTAL}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id="ep2"
      component={Episode2}
      durationInFrames={EP2_TOTAL}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id="ep3"
      component={Episode3}
      durationInFrames={EP3_TOTAL}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id="ep4"
      component={Episode4}
      durationInFrames={EP4_TOTAL}
      fps={30}
      width={1080}
      height={1920}
    />
  </>
);
