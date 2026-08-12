/**
 * Open Doodles — the app's illustration library.
 *
 * ORIGIN AND LICENSE. Open Doodles is Pablo Stanley's free illustration set
 * (opendoodles.com), released for use "in any personal or commercial
 * project"; these files were vendored from the MIT-licensed
 * `react-open-doodles` package (rendered to static SVG once, dependency
 * removed) so the app carries no runtime package and Lovable's build sees
 * no react-15-era peer pins. Human-drawn, NOT AI-generated — no AI label
 * applies to surfaces that render them.
 *
 * TWO JOBS. Today: decoration — the chat doodle wallpaper's corner accent
 * and empty states. Tomorrow: FUTURE VIDEO GENERATION (owner directive,
 * 2026-08-12) — these are clean, license-safe stills the Story pipeline can
 * composite, animate under Ken Burns, or hand to the clip stage as start
 * frames. Declared here, next to the assets, so provenance never lives only
 * in a chat log.
 */
import SittingDoodle from "@/assets/doodles/SittingDoodle.svg";
import ReadingDoodle from "@/assets/doodles/ReadingDoodle.svg";
import DancingDoodle from "@/assets/doodles/DancingDoodle.svg";
import LovingDoodle from "@/assets/doodles/LovingDoodle.svg";
import CoffeeDoodle from "@/assets/doodles/CoffeeDoodle.svg";
import StrollingDoodle from "@/assets/doodles/StrollingDoodle.svg";
import SelfieDoodle from "@/assets/doodles/SelfieDoodle.svg";
import MeditatingDoodle from "@/assets/doodles/MeditatingDoodle.svg";
import PlantDoodle from "@/assets/doodles/PlantDoodle.svg";
import DogJumpDoodle from "@/assets/doodles/DogJumpDoodle.svg";
import JumpingDoodle from "@/assets/doodles/JumpingDoodle.svg";
import GroovyDoodle from "@/assets/doodles/GroovyDoodle.svg";

export type Doodle = {
  key: string;
  /** What the figure is doing — usable as an image-generation reference tag. */
  label: string;
  src: string;
};

export const DOODLES: readonly Doodle[] = [
  { key: "sitting", label: "sitting and browsing", src: SittingDoodle },
  { key: "reading", label: "reading a book", src: ReadingDoodle },
  { key: "dancing", label: "dancing", src: DancingDoodle },
  { key: "loving", label: "holding a heart", src: LovingDoodle },
  { key: "coffee", label: "enjoying a coffee", src: CoffeeDoodle },
  { key: "strolling", label: "strolling with music", src: StrollingDoodle },
  { key: "selfie", label: "taking a selfie", src: SelfieDoodle },
  { key: "meditating", label: "meditating", src: MeditatingDoodle },
  { key: "plant", label: "watering a plant", src: PlantDoodle },
  { key: "dogjump", label: "playing with a dog", src: DogJumpDoodle },
  { key: "jumping", label: "jumping with joy", src: JumpingDoodle },
  { key: "groovy", label: "grooving", src: GroovyDoodle },
] as const;

/**
 * Stable pick per conversation: the same chat always wears the same figure,
 * different chats wear different ones. FNV-1a over the id — cheap, no state.
 */
export function doodleFor(seed: string): Doodle {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return DOODLES[(h >>> 0) % DOODLES.length];
}
