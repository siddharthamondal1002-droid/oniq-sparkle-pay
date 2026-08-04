import fs from "fs";
import { buildCvPdf } from "./src/lib/cvPdf";
const long = (n:number)=>Array.from({length:n},(_,i)=>`Bullet ${i+1}: `+"delivered measurable outcomes across a very long sentence that must wrap onto multiple lines to test pagination properly. ".repeat(2));
const declared:any = { fullName:"Aarav Krishnamurthy Venkataraman Subramanian Extra Long Name Here", headline:"Senior Platform Engineer", email:"a@b.com", phone:"+91 90000 00000", location:"Bengaluru, India", personal:{} };
const cv:any = {
  summary:"Experienced engineer. ".repeat(60),
  roles: Array.from({length:8},(_,i)=>({title:`Very Long Job Title Number ${i+1} With Quite A Few Extra Words In It`, employer:`Company ${i+1} Private Limited`, start:"2019", end:"2022", bullets: long(5)})),
  credentials: Array.from({length:25},(_,i)=>({name:`Qualification ${i+1} in Something Lengthy`, issuer:"Central Board of Secondary Education", year:`20${10+i%15}`})),
  skills: Array.from({length:120},(_,i)=>`Skill${i+1}`),
};
const doc = await buildCvPdf(declared, cv);
fs.writeFileSync("/tmp/qa/cv.pdf", Buffer.from(doc.output("arraybuffer") as ArrayBuffer));
console.log("pages", doc.getNumberOfPages());
