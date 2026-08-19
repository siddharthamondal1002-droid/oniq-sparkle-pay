/**
 * AI PROVENANCE — one source of truth for "who or what made this, and how do
 * you prove it later".
 *
 * India's IT Amendment Rules 2026, in force since 20 February 2026, ask for
 * two separate things and they are easy to conflate:
 *
 *   1. PROMINENT LABELLING — visible to the person watching, on the surface,
 *      while they watch. A note on the Play listing or on oniqhub.com does not
 *      reach the person who is looking at the video.
 *   2. NON-REMOVABLE PROVENANCE METADATA — machine-readable, travelling with
 *      the FILE, so the claim survives the video being downloaded, forwarded
 *      and re-posted somewhere that has never heard of ONIQ.
 *
 * The second one is the one that gets assumed rather than checked. An ffprobe
 * of the published Episode 2 on 19 Aug 2026 carried exactly two tags —
 * `encoder=Lavf61.7.100` and `comment=Made with Remotion 4.0.507`. Nothing
 * said AI, nothing said ONIQ, nothing said which model. The render chain had
 * never been asked to write it, so it never did, and nobody had looked.
 *
 * "Non-removable" is aspirational for anyone — MP4 tags survive a copy, a
 * download and a forward, but not a deliberate re-mux. That is the honest
 * ceiling of container metadata and it is what the rule can actually mean:
 * the burden is to EMIT durable provenance, not to make stripping impossible.
 * So this module is deliberately also the app-side record: even if a file's
 * tags are stripped downstream, ONIQ's own claim about its own content is
 * still assertable from here.
 *
 * TAKEDOWN WINDOWS, so the numbers are somewhere a person can find them:
 * three hours for a valid complaint, TWO hours where the complaint is of
 * sexual content or a deepfake. Those are wall-clock hours from receipt, which
 * is why the report control has to be on the surface rather than behind an
 * email address someone reads on Monday.
 */

/** Written into every generated file AND rendered on every AI surface. */
export const AI_OUTPUT_LABEL_TEXT = "AI-generated";

/** The statutory clocks. Hours, from receipt of a valid complaint. */
export const TAKEDOWN_HOURS = {
  standard: 3,
  /** Sexual content or a deepfake. Half the standard window. */
  sexualOrDeepfake: 2,
} as const;

export type Provenance = {
  /** Matches the LoreVideo id and the episode asset basename. */
  id: string;
  title: string;
  /** Stills. Firefly or Veo on Vertex only — never Midjourney. See C3. */
  imageModel: string;
  /** Motion. */
  videoModel: string;
  /**
   * Voice. SYNTHETIC ONLY, NEVER CLONED — Indian courts have granted fast
   * injunctions on AI voice cloning and a cloned voice is a personality-rights
   * claim from a named plaintiff, not a content-policy question.
   */
  voice: string;
  /** How the clips became a film. */
  assembly: string;
  /** ISO date the film was finished. */
  produced: string;
};

/**
 * Season one. Every field here is a claim ONIQ is making publicly, so it says
 * what was actually used rather than what the pipeline was supposed to use.
 */
export const EPISODE_PROVENANCE: Provenance[] = [
  {
    id: "ep1",
    title: "The Fisherman and the Jinni",
    imageModel: "Google Imagen (Vertex AI)",
    videoModel: "Runway Gen-3 (image-to-video)",
    voice: "Synthetic TTS — no cloned voice",
    assembly: "Remotion",
    produced: "2026-08-07",
  },
  {
    id: "ep2",
    title: "Ali Baba and the Forty Thieves",
    imageModel: "Google Imagen (Vertex AI)",
    videoModel: "Runway Gen-3 (image-to-video)",
    voice: "Synthetic TTS — no cloned voice",
    assembly: "Remotion",
    produced: "2026-08-08",
  },
  {
    id: "ep3",
    title: "Aladdin and the Wonderful Lamp",
    imageModel: "Google Imagen (Vertex AI)",
    videoModel: "Google Veo (image-to-video, Vertex AI)",
    voice: "Synthetic TTS — no cloned voice",
    assembly: "Remotion",
    produced: "2026-08-09",
  },
  {
    id: "ep4",
    title: "Aladdin and the Ember King",
    imageModel: "Google Imagen (Vertex AI)",
    videoModel: "Google Veo (image-to-video, Vertex AI)",
    voice: "Synthetic TTS — no cloned voice",
    assembly: "Remotion",
    produced: "2026-08-13",
  },
];

export function provenanceFor(id: string): Provenance | null {
  return EPISODE_PROVENANCE.find((p) => p.id === id) ?? null;
}

/**
 * The MP4 tag set. Shared verbatim by the render script (which writes it) and
 * the verifier (which refuses to let an episode ship without it), so the two
 * cannot drift into a check that passes against nothing.
 *
 * `comment` carries the human sentence because it is the one tag consumer
 * players actually surface. The IPTC digitalSourceType URI is the
 * machine-readable form other tools look for; it is the same vocabulary C2PA
 * uses for `trainedAlgorithmicMedia`, so a scanner that knows the standard
 * recognises it without knowing anything about ONIQ.
 */
export const DIGITAL_SOURCE_TYPE_AI =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

export function provenanceTags(p: Provenance): Record<string, string> {
  return {
    title: `ONIQ Originals — ${p.title}`,
    comment: `${AI_OUTPUT_LABEL_TEXT}. Made by ONIQ with generative AI. Stills: ${p.imageModel}. Motion: ${p.videoModel}. Voice: ${p.voice}. Assembly: ${p.assembly}.`,
    artist: "ONIQ Originals",
    copyright: `© ONIQ ${new Date(p.produced).getUTCFullYear()}`,
    date: p.produced,
    genre: "AI-generated",
    // Non-standard keys need -movflags use_metadata_tags to survive into the
    // MP4 udta atom; without that flag ffmpeg silently drops them, which is
    // the specific way this check passes locally and fails on the shipped file.
    digital_source_type: DIGITAL_SOURCE_TYPE_AI,
    ai_generated: "true",
    ai_generator: `${p.imageModel} + ${p.videoModel}`,
  };
}

/** The tags a shipped file MUST carry. The verifier fails on any missing. */
export const REQUIRED_PROVENANCE_TAGS = [
  "comment",
  "digital_source_type",
  "ai_generated",
] as const;
