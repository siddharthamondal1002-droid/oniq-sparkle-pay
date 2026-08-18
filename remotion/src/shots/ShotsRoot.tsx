/** One <Composition> per shot — the driver selects them by id. */
import { Composition } from 'remotion';
import { DIMS, SHOTS } from './library';
import { PromoShot } from './PromoShot';

export const ShotsRoot: React.FC = () => (
  <>
    {SHOTS.map((shot) => (
      <Composition
        key={shot.id}
        id={shot.id}
        component={PromoShot}
        durationInFrames={shot.dur}
        fps={30}
        width={DIMS[shot.aspect].width}
        height={DIMS[shot.aspect].height}
        defaultProps={{ shot }}
      />
    ))}
  </>
);
