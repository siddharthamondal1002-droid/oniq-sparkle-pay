/**
 * StoryModel — the one call the Director makes to get a story.
 *
 * Owner directive 2026-08-27 (finalize the ready layer). The Director must
 * never know that a model exists, let alone whose. It asks for a story and
 * receives a VALIDATED Story IR or an error; everything between — DNA
 * retrieval, blending, prompting, parsing, repair, validation — happens
 * behind this interface.
 *
 *   idea + duration + constraints
 *      -> Story DNA retrieval and blend
 *      -> the local model
 *      -> repair
 *      -> validate
 *      -> Story IR, or a refusal with the reasons
 *
 * PROVIDER-NEUTRAL BY CONSTRUCTION. The only way tokens are produced is
 * the `invoke` transport the caller supplies. There is no default, no
 * registry, no base URL, and no branch anywhere that could reach a
 * network service. Handing this a local model makes it work; handing it
 * nothing makes it fail, which is the correct behaviour while no
 * checkpoint is baked.
 */

import { briefFor, type DnaEntry, type StoryBrief } from "./storyDna.ts";
import { LocalModelUnavailable, type LocalInvoke, generateStoryIr } from "./localStoryModel.ts";
import { validateStoryIr, type IrProblem, type StoryIr } from "./storyIr.ts";

export type StoryRequest = {
  idea: string;
  seconds: number;
  grade: "classic" | "movie";
  /** Stable per film, so a retry of the same film draws the same DNA. */
  seed: string;
  /** Characters the user already established, carried through untouched. */
  characters?: { name: string; description: string }[];
  /** Anything the story must respect. Free text, handed to the model. */
  constraints?: string[];
  /** Test seam: substitute a library. Production uses the real one. */
  library?: readonly DnaEntry[];
};

export class StoryInvalid extends Error {
  constructor(readonly problems: IrProblem[]) {
    super(`the story did not validate: ` + problems.map((p) => `${p.code}@${p.where}`).join(", "));
  }
}

export type StoryResult = {
  ir: StoryIr;
  brief: StoryBrief;
  /** Empty on success — kept so a caller can log a clean run's checks. */
  problems: IrProblem[];
};

/**
 * Generate one story.
 *
 * Validation is not advisory here: an IR with problems is thrown, never
 * returned, because the Director's next act is to build a production
 * graph and spend GPU money on it. Invalid story, zero jobs, zero spend —
 * which is the whole reason the validator runs before the graph exists.
 */
export async function generateStory(
  request: StoryRequest,
  invoke?: LocalInvoke,
): Promise<StoryResult> {
  const brief = briefFor(request.idea, request.seconds, request.seed, request.library);
  const withConstraints: StoryBrief = request.constraints?.length
    ? { ...brief, idea: [brief.idea, ...request.constraints].join("\n") }
    : brief;

  const ir = await generateStoryIr(withConstraints, invoke);

  // Characters the user already established are theirs, not the model's:
  // the model may add to the cast, never redefine what the user wrote.
  if (request.characters?.length) {
    const established = new Map(request.characters.map((c) => [c.name, c.description]));
    ir.characters = ir.characters.map((c) =>
      established.has(c.name) ? { ...c, appearance: established.get(c.name)! } : c,
    );
  }

  const problems = validateStoryIr(ir, { movieGrade: request.grade === "movie" });
  if (problems.length) throw new StoryInvalid(problems);
  return { ir, brief, problems };
}

/**
 * Is a local story model available at all?
 *
 * The Director calls this before it promises a user anything, so an
 * absent checkpoint surfaces as a clear refusal at the door rather than
 * as a failure after a reservation has been taken.
 */
export async function storyModelAvailable(invoke?: LocalInvoke): Promise<boolean> {
  if (!invoke) return false;
  try {
    await invoke("ping", { maxTokens: 1 });
    return true;
  } catch {
    return false;
  }
}

export { LocalModelUnavailable };
