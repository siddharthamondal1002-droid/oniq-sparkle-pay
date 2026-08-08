import { AbsoluteFill } from 'remotion';
import { TransitionSeries, springTiming } from '@remotion/transitions';
import { wipe } from '@remotion/transitions/wipe';
import { slide } from '@remotion/transitions/slide';
import { Backdrop } from './components/Backdrop';
import { SceneHook } from './scenes/SceneHook';
import { SceneWorlds } from './scenes/SceneWorlds';
import { SceneStudy } from './scenes/SceneStudy';
import { ScenePay } from './scenes/ScenePay';
import { SceneConnect } from './scenes/SceneConnect';
import { SceneClose } from './scenes/SceneClose';

const T = 20;
const timing = springTiming({ config: { damping: 200 }, durationInFrames: T });

export const MainVideo: React.FC = () => (
  <AbsoluteFill>
    <Backdrop />
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={100}>
        <SceneHook />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={wipe({ direction: 'from-bottom' })} timing={timing} />
      <TransitionSeries.Sequence durationInFrames={140}>
        <SceneWorlds />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: 'from-right' })} timing={timing} />
      <TransitionSeries.Sequence durationInFrames={150}>
        <SceneStudy />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={wipe({ direction: 'from-bottom' })} timing={timing} />
      <TransitionSeries.Sequence durationInFrames={150}>
        <ScenePay />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: 'from-right' })} timing={timing} />
      <TransitionSeries.Sequence durationInFrames={140}>
        <SceneConnect />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={wipe({ direction: 'from-bottom' })} timing={timing} />
      <TransitionSeries.Sequence durationInFrames={120}>
        <SceneClose />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);

// 800 scene frames minus 5 overlapping transitions of 20 frames each.
export const TOTAL = 800 - 5 * T;
