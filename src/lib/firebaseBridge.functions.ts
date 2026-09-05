// The RPC face of the Firebase bridge.
//
// Thin on purpose: authorisation is the middleware's, the rules are
// firebaseBridge.server.ts's, and this file only carries the verified user id
// across. The server-only module is imported INSIDE the handler because route
// and *.functions.ts modules enter the client graph at their top level.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BridgeRequest, BridgeResponse } from "./firebaseBridge.server";

export const firebaseBridge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: BridgeRequest) => d)
  .handler(async ({ data, context }): Promise<BridgeResponse> => {
    const { runBridge } = await import("./firebaseBridge.server");
    return await runBridge(context.userId, data);
  });
