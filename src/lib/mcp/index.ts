import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listConversationsTool from "./tools/list-conversations";

// The OAuth issuer must be the direct Supabase host (see ai-sdk-mcp-client guidance).
// VITE_SUPABASE_PROJECT_ID is inlined by Vite at build time.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "oniq-mcp",
  title: "ONIQ",
  version: "0.1.0",
  instructions:
    "ONIQ super-app tools. Callers must sign in with their ONIQ account. Tools act as that user under Supabase RLS: list chat conversations and read the user's profile.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listConversationsTool],
});
