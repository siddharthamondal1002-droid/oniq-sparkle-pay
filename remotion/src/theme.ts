import { loadFont as loadDisplay } from '@remotion/google-fonts/SpaceGrotesk';
import { loadFont as loadBody } from '@remotion/google-fonts/DMSans';

export const display = loadDisplay('normal', { weights: ['500', '700'], subsets: ['latin'] })
  .fontFamily;
export const body = loadBody('normal', { weights: ['400', '500'], subsets: ['latin'] }).fontFamily;

export const C = {
  bg: '#0E0F13',
  surface: '#16181E',
  line: '#242833',
  teal: '#00D4B8',
  ember: '#FF8A3D',
  text: '#F3F5F7',
  muted: '#8A93A3',
};

export const EASE = [0.22, 1, 0.36, 1] as const;
