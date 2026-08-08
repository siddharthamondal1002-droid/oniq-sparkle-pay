import { Composition } from 'remotion';
import { MainVideo, TOTAL } from './MainVideo';
import { Episode1 } from './ep1/Episode1';
import { EP1_TOTAL } from './ep1/manifest';
import { Episode2 } from './ep2/Episode2';
import { EP2_TOTAL } from './ep2/manifest';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="main"
      component={MainVideo}
      durationInFrames={TOTAL}
      fps={30}
      width={1080}
      height={1920}
    />
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
  </>
);
