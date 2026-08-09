// One mouth, on one frame.
//
// Deliberately dumb, exactly like the episode compositions: it is handed a
// viseme and draws it. It does no lookup, holds no cue track and knows nothing
// about audio. The skill's rule for the episode manifest applies here for the
// same reason — "the manifest is smart, the composition is dumb" — because a
// component that decided its own shape could not be checked against anything
// without rendering it.
import React from 'react';
import type { Viseme } from '../../../src/lib/visemes';
import { MOUTH_SHAPES, MOUTH_VIEWBOX } from './mouthShapes';

export type MouthProps = {
  viseme: Viseme;
  /** Width on the canvas, in px. Height follows the viewBox ratio. */
  width: number;
  /** Lip colour. */
  color?: string;
  /** Inside of the mouth. */
  innerColor?: string;
  teethColor?: string;
};

export const Mouth: React.FC<MouthProps> = ({
  viseme,
  width,
  color = '#5c2018',
  innerColor = '#38100c',
  teethColor = '#f6efe4',
}) => {
  const shape = MOUTH_SHAPES[viseme];
  const height = (width * MOUTH_VIEWBOX.height) / MOUTH_VIEWBOX.width;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${MOUTH_VIEWBOX.width} ${MOUTH_VIEWBOX.height}`}
      // No transition and no animation. Remotion renders discrete frames, and a
      // CSS transition would either be ignored or — worse — sampled halfway,
      // making the shape depend on wall-clock time rather than frame number.
      // Determinism is the whole reason this pipeline is worth having.
      style={{ display: 'block', overflow: 'visible' }}
    >
      <path d={shape.outline} fill={color} />
      {shape.opening ? <path d={shape.opening} fill={innerColor} /> : null}
      {shape.teeth ? <path d={shape.teeth} fill={teethColor} /> : null}
    </svg>
  );
};
