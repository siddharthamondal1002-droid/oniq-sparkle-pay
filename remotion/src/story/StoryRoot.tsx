// The Story composition, alone in its bundle.
//
// Separate Root for the same reason EpisodesRoot exists: index.ts pulls in the
// promo, the promo pulls theme.ts, and theme.ts fetches Google Fonts at module
// scope, which dies behind this container's proxy with a bare "NetworkError"
// before a single frame renders.
import { Composition } from 'remotion';
import { StoryFilm, calculateStoryMetadata, STORY_FPS, type StoryFilmProps } from './StoryFilm';

/** Placeholder props. Every real render passes its own through inputProps. */
const DEFAULT: StoryFilmProps = { title: 'Story', shots: [] };

export const StoryRoot: React.FC = () => (
  <Composition
    id="story"
    component={StoryFilm}
    // A plan with no shots throws in calculateMetadata, so this default exists
    // only to satisfy the registration — it is never rendered.
    durationInFrames={1}
    fps={STORY_FPS}
    width={1080}
    height={1920}
    defaultProps={DEFAULT}
    calculateMetadata={calculateStoryMetadata}
  />
);
