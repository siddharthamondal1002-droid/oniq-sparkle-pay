#!/usr/bin/env python3
# Phase 12 — quantitative seam / detachment metric for an L3R walk gif.
#   holes_mean       : mean area of BACKGROUND enclosed by the character per frame
#                      (gaps that open between parts at joints) — lower is better.
#   components_mean  : mean # of connected character components per frame
#                      (1.0 = intact; >1 = a limb/hand detached) — 1.0 is best.
#   extra_comp_frac  : fraction of frames with >1 component (any detachment).
import sys, json
from PIL import Image, ImageSequence
import numpy as np, cv2
gif=sys.argv[1]
im=Image.open(gif)
holes=[]; comps=[]
for f in ImageSequence.Iterator(im):
    r=np.array(f.convert("RGBA")); a=r[:,:,3:4]/255.0
    rgb=(r[:,:,:3]*a+255*(1-a)).astype(np.uint8)
    g=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    fgm=(g<245).astype(np.uint8)
    # connected components of the character
    nc,_=cv2.connectedComponents(fgm)
    comps.append(nc-1)
    # enclosed background holes: flood bg from border; unreached bg = holes
    ff=fgm.copy()
    h,w=ff.shape; m=np.zeros((h+2,w+2),np.uint8)
    cv2.floodFill(ff,m,(0,0),1)             # fill outside bg with 1
    holes.append(int(((ff==0)).sum()))       # remaining 0s = enclosed bg (gaps)
holes=np.array(holes); comps=np.array(comps)
print(json.dumps({
    "frames":len(comps),
    "holes_mean":round(float(holes.mean()),1),
    "holes_max":int(holes.max()),
    "components_mean":round(float(comps.mean()),3),
    "extra_comp_frac":round(float((comps>1).mean()),3),
}))
