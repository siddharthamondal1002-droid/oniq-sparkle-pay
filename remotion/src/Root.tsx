import { Composition } from 'remotion';
import { MainVideo, TOTAL } from './MainVideo';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="main"
    component={MainVideo}
    durationInFrames={TOTAL}
    fps={30}
    width={1080}
    height={1920}
  />
);
