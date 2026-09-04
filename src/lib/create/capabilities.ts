/**
 * CREATE — what ONIQ can actually make today, and where each thing lives.
 *
 * Owner mission, 2026-09-03, reference "use it as given": six cards in the
 * reference's order (Image, Video, Character, Voice, Music, Document) and
 * an AI banner. A capability is `live` only when a real screen exists behind
 * `to`; everything else is drawn as not yet available and goes nowhere — no
 * placeholder screen that looks finished and does nothing.
 * src/lib/__tests__/createCapabilities.test.ts checks every live `to`
 * resolves to an existing route file.
 *
 * Nothing here names a model, a GPU, or a vendor. The backend decides.
 */
import type { Tint } from "@/design/tints";

export type CreateCapabilityId =
  "image" | "video" | "character" | "voice" | "music" | "document" | "ai" | "clip";

export type CreateCapability = {
  id: CreateCapabilityId;
  label: string;
  hint: string;
  emoji: string;
  /**
   * The card's own identity colour, owner reference 2026-09-04: each of the
   * six grid cards reads as its own thing, not as six instances of Create's
   * single world gradient.
   *
   * A NAME from the tint contract, not a hex. It was a hex, and a hex here
   * meant this file owned a colour that the world tiles and Explore rows
   * owned separately — three copies of "what colour is Music", already
   * disagreeing with each other and with the reference. The values live once,
   * in the [data-tint] blocks in styles.css.
   */
  tint?: Tint;
  status: "live" | "soon";
  to?: string;
  search?: Record<string, string>;
};

/** The six grid cards, in the reference's order. */
export const CREATE_GRID: CreateCapability[] = [
  {
    id: "image",
    label: "Image",
    hint: "Describe a picture, get it",
    emoji: "🖼️",
    tint: "rose",
    status: "live",
    to: "/app/image",
  },
  {
    id: "video",
    label: "Video",
    hint: "Animate a scene, or a short story film",
    emoji: "🎥",
    tint: "indigo",
    status: "live",
    to: "/app/lores",
    search: { tab: "stories" },
  },
  {
    id: "character",
    label: "Character",
    hint: "Describe a character, get their stills",
    emoji: "🧑‍🎤",
    tint: "orange",
    status: "live",
    to: "/app/lores",
    search: { tab: "stories" },
  },
  {
    id: "voice",
    // The reference's hint named three things; only Speak ships, so the card
    // says Speak. Cloning is a consent question before it is an engineering
    // one, and translating is the text path's job.
    label: "Voice",
    hint: "Type a line, hear it spoken",
    emoji: "🎙️",
    tint: "blue",
    status: "live",
    to: "/app/voice",
  },
  {
    id: "music",
    label: "Music",
    hint: "Generate soundtrack",
    emoji: "🎵",
    tint: "pink",
    status: "live",
    to: "/app/music",
  },
  {
    id: "document",
    label: "Document",
    hint: "Read / Summarise / Understand",
    emoji: "📄",
    tint: "green",
    status: "live",
    to: "/app/ai",
  },
];

/** The banner under the grid. */
export const CREATE_AI: CreateCapability = {
  id: "ai",
  label: "AI",
  hint: "Ask / Research / Create",
  emoji: "🔮",
  status: "live",
  to: "/app/ai",
};

/** A real thing people make every day that the reference did not draw. */
export const CREATE_CLIP: CreateCapability = {
  id: "clip",
  label: "Post a clip",
  hint: "A video of your own",
  emoji: "📼",
  status: "live",
  to: "/app/clips",
};

export const CREATE_CAPABILITIES: CreateCapability[] = [...CREATE_GRID, CREATE_AI, CREATE_CLIP];
export const LIVE_CAPABILITIES = CREATE_CAPABILITIES.filter((c) => c.status === "live");
export const SOON_CAPABILITIES = CREATE_CAPABILITIES.filter((c) => c.status === "soon");
