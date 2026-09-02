// stillStoreClient — the signing client, and nothing else.
//
// THE ONLY FILE HERE THAT IMPORTS A REMOTE MODULE, which is the whole reason
// it is a file. aws4fetch cannot be resolved by vitest (no https loader) or by
// `tsc` (no module declaration), so anything importing it becomes unverifiable
// by association. Keeping it alone means stillStore.ts — the PNG rule, the
// byte handling, the write and its read-back — is fully checkable, and the
// unverifiable surface is this one constructor.
//
// story-still composes the two: readStillStoreEnv validates, openStillStore
// signs, storeStill writes.

import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

import type { StillStore, StillStoreCredentials } from "./stillStore.ts";

/** R2 is S3-compatible; the region is fixed for signing and is not a location. */
const SIGNING_REGION = "auto";

/**
 * Build the signing client from validated credentials.
 */
export function openStillStore(creds: StillStoreCredentials): StillStore {
  return {
    r2: new AwsClient({
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      region: SIGNING_REGION,
      service: "s3",
    }),
    endpoint: creds.endpoint,
  };
}

