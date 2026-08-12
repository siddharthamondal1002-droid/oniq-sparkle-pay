/**
 * Open Doodles — the app's illustration library. All 33 of them.
 *
 * ORIGIN AND LICENSE. Open Doodles is Pablo Stanley's free illustration set
 * (opendoodles.com), released for use "in any personal or commercial
 * project"; these files were vendored from the MIT-licensed
 * `react-open-doodles` package (rendered to static SVG once, dependency
 * removed) so the app carries no runtime package and Lovable's build sees
 * no react-15-era peer pins. Human-drawn, NOT AI-generated — no AI label
 * applies to surfaces that render them.
 *
 * THREE JOBS. The chat wallpaper scatters them behind every thread; the
 * attachment sheet lets anyone SEND one as a sticker-sized drawing; and they
 * are clean, license-safe stills the Story pipeline can composite or animate
 * for FUTURE VIDEO GENERATION (owner directive, 2026-08-12). Declared here,
 * next to the assets, so provenance never lives only in a chat log.
 *
 * The labels are written as what the figure is DOING, not as a filename —
 * they are the alt text a screen reader speaks, the caption a search box
 * matches, and the reference tag an image prompt would carry.
 */
import BalletDoodle from "@/assets/doodles/BalletDoodle.svg";
import BikiniDoodle from "@/assets/doodles/BikiniDoodle.svg";
import ChillingDoodle from "@/assets/doodles/ChillingDoodle.svg";
import ClumsyDoodle from "@/assets/doodles/ClumsyDoodle.svg";
import CoffeeDoodle from "@/assets/doodles/CoffeeDoodle.svg";
import DancingDoodle from "@/assets/doodles/DancingDoodle.svg";
import DogJumpDoodle from "@/assets/doodles/DogJumpDoodle.svg";
import DoggieDoodle from "@/assets/doodles/DoggieDoodle.svg";
import FloatDoodle from "@/assets/doodles/FloatDoodle.svg";
import GroovyDoodle from "@/assets/doodles/GroovyDoodle.svg";
import IceCreamDoodle from "@/assets/doodles/IceCreamDoodle.svg";
import JumpingDoodle from "@/assets/doodles/JumpingDoodle.svg";
import LayingDoodle from "@/assets/doodles/LayingDoodle.svg";
import LevitateDoodle from "@/assets/doodles/LevitateDoodle.svg";
import LovingDoodle from "@/assets/doodles/LovingDoodle.svg";
import MeditatingDoodle from "@/assets/doodles/MeditatingDoodle.svg";
import MoshingDoodle from "@/assets/doodles/MoshingDoodle.svg";
import PettingDoodle from "@/assets/doodles/PettingDoodle.svg";
import PlantDoodle from "@/assets/doodles/PlantDoodle.svg";
import ReadingDoodle from "@/assets/doodles/ReadingDoodle.svg";
import ReadingSideDoodle from "@/assets/doodles/ReadingSideDoodle.svg";
import RollerSkatingDoodle from "@/assets/doodles/RollerSkatingDoodle.svg";
import RollingDoodle from "@/assets/doodles/RollingDoodle.svg";
import RunningDoodle from "@/assets/doodles/RunningDoodle.svg";
import SelfieDoodle from "@/assets/doodles/SelfieDoodle.svg";
import SittingDoodle from "@/assets/doodles/SittingDoodle.svg";
import SittingReadingDoodle from "@/assets/doodles/SittingReadingDoodle.svg";
import SleekDoodle from "@/assets/doodles/SleekDoodle.svg";
import SprintingDoodle from "@/assets/doodles/SprintingDoodle.svg";
import StrollingDoodle from "@/assets/doodles/StrollingDoodle.svg";
import SwingingDoodle from "@/assets/doodles/SwingingDoodle.svg";
import UnboxingDoodle from "@/assets/doodles/UnboxingDoodle.svg";
import ZombieingDoodle from "@/assets/doodles/ZombieingDoodle.svg";

export type Doodle = {
  key: string;
  /** What the figure is doing — alt text, search term, image-reference tag. */
  label: string;
  src: string;
};

export const DOODLES: readonly Doodle[] = [
  { key: "ballet", label: "dancing ballet", src: BalletDoodle },
  { key: "bikini", label: "running in a swimsuit", src: BikiniDoodle },
  { key: "chilling", label: "chilling on the floor", src: ChillingDoodle },
  { key: "clumsy", label: "tripping over", src: ClumsyDoodle },
  { key: "coffee", label: "enjoying a coffee", src: CoffeeDoodle },
  { key: "dancing", label: "dancing with headphones", src: DancingDoodle },
  { key: "dogjump", label: "playing with a jumping dog", src: DogJumpDoodle },
  { key: "doggie", label: "petting a happy dog", src: DoggieDoodle },
  { key: "float", label: "floating away", src: FloatDoodle },
  { key: "groovy", label: "grooving", src: GroovyDoodle },
  { key: "icecream", label: "carrying a giant ice cream", src: IceCreamDoodle },
  { key: "jumping", label: "jumping with joy", src: JumpingDoodle },
  { key: "laying", label: "laying down on a phone", src: LayingDoodle },
  { key: "levitate", label: "levitating", src: LevitateDoodle },
  { key: "loving", label: "holding a heart", src: LovingDoodle },
  { key: "meditating", label: "meditating", src: MeditatingDoodle },
  { key: "moshing", label: "moshing at a gig", src: MoshingDoodle },
  { key: "petting", label: "sitting with a dog", src: PettingDoodle },
  { key: "plant", label: "carrying a big plant", src: PlantDoodle },
  { key: "reading", label: "reading a book", src: ReadingDoodle },
  { key: "readingside", label: "reading, leaning back", src: ReadingSideDoodle },
  { key: "rollerskating", label: "roller skating", src: RollerSkatingDoodle },
  { key: "rolling", label: "rolling along", src: RollingDoodle },
  { key: "running", label: "running fast", src: RunningDoodle },
  { key: "selfie", label: "taking a selfie", src: SelfieDoodle },
  { key: "sitting", label: "sitting and browsing", src: SittingDoodle },
  { key: "sittingreading", label: "sitting cross-legged, reading", src: SittingReadingDoodle },
  { key: "sleek", label: "striding along", src: SleekDoodle },
  { key: "sprinting", label: "sprinting", src: SprintingDoodle },
  { key: "strolling", label: "strolling with music", src: StrollingDoodle },
  { key: "swinging", label: "on a swing", src: SwingingDoodle },
  { key: "unboxing", label: "unboxing a parcel", src: UnboxingDoodle },
  { key: "zombieing", label: "zombie-walking", src: ZombieingDoodle },
] as const;

const BY_KEY = new Map(DOODLES.map((d) => [d.key, d]));

/** Look one up by key — how a sent doodle message resolves back to a drawing. */
export function doodleByKey(key: string): Doodle | undefined {
  return BY_KEY.get(key);
}

/** FNV-1a. Cheap, stateless, and stable across reloads and devices. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Stable pick per conversation: the same chat always wears the same figure,
 * different chats wear different ones.
 */
export function doodleFor(seed: string): Doodle {
  return DOODLES[hash(seed) % DOODLES.length];
}

/**
 * A whole wallpaper's worth, deterministically — same chat, same scatter,
 * every time it opens. Positions come out of the same hash as the pick, so
 * no layout state is stored and nothing shifts on re-render.
 *
 * The figures are spread across the vertical run of the thread rather than
 * clustered, and alternate sides, so scrolling reveals new ones instead of
 * showing the same corner motif over and over.
 */
export type ScatteredDoodle = Doodle & {
  /** Viewport height units down the thread — kept clear of header and composer. */
  top: number;
  /** Percentage across, from the inline start edge (RTL-safe). */
  start: number;
  size: number;
  rotate: number;
  flip: boolean;
};

export function doodleScatter(seed: string, count = 4): ScatteredDoodle[] {
  const h = hash(seed);
  const out: ScatteredDoodle[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    // Decorrelate the streams so size does not track position.
    const a = hash(`${seed}:${i}`);
    const b = hash(`${seed}:${i}:b`);
    // No repeats within one wallpaper — the same figure twice reads as a bug.
    let pick = DOODLES[(h + a) % DOODLES.length];
    for (let n = 1; used.has(pick.key) && n <= DOODLES.length; n++) {
      pick = DOODLES[(h + a + n) % DOODLES.length];
    }
    used.add(pick.key);
    out.push({
      ...pick,
      // 6vh–84vh: below the header, above the composer.
      top: 6 + (i * 78) / count + (a % 5),
      start: i % 2 === 0 ? 1 + (a % 12) : 54 + (b % 14),
      size: 104 + (b % 68),
      rotate: (a % 25) - 12,
      flip: b % 2 === 0,
    });
  }
  return out;
}
