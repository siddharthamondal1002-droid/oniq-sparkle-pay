// Render entry point for a STORY. See StoryRoot.tsx for why it is separate
// from index.ts.
import { registerRoot } from 'remotion';
import { StoryRoot } from './story/StoryRoot';

registerRoot(StoryRoot);
