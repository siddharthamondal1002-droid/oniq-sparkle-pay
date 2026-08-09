// The rig proof, and ONLY the rig proof.
//
// A separate Root for the same reason EpisodesRoot exists: Root.tsx also
// registers the promo, the promo pulls Space Grotesk and DM Sans from
// fonts.gstatic.com at MODULE SCOPE via theme.ts, and behind this container's
// proxy that dies with ERR_CERT_AUTHORITY_INVALID before a single frame
// renders. Bundling the promo alongside anything else is what makes a render
// fail with a bare "NetworkError" that looks like a Remotion fault.
//
// This composition draws no text and needs no font.
import { Composition } from 'remotion';
import { RigProof, PROOF_FRAMES } from './RigProof';

export const RigRoot: React.FC = () => (
  <Composition
    id="rig-proof"
    component={RigProof}
    durationInFrames={PROOF_FRAMES}
    fps={30}
    width={1080}
    height={1920}
  />
);
