import { ORIGINALS, stillPromptFor } from "../data/originals";
import { narrationFor } from "../data/originalsScript";
const ep = ORIGINALS.find((e:any)=>e.id==="ep2")!;
const out:any = {};
for (const s of ep.scenes) out[s.id] = { prompt: stillPromptFor(s as any), narration: narrationFor(s.id) };
console.log(JSON.stringify(out, null, 2));
