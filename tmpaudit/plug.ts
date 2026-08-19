import * as R from "@/data/appRegistry";
for (const [k,v] of Object.entries(R)) {
  if (Array.isArray(v)) console.log(k, v.length, "hidden:", v.filter((x:any)=>x&&x.hidden).length);
}
