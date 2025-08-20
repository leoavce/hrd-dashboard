// js/utils/helpers.js
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/** 연도 맵 로드 */
export async function loadYears(db, programId, years){
  const out = {};
  for (const y of years){
    const snap = await getDoc(doc(db,'programs',programId,'years',y));
    out[y] = snap.exists()? snap.data() : {};
  }
  return out;
}

export const fmt = new Intl.NumberFormat('ko-KR');

export function pickRandom(arr, n){
  const a = (arr||[]).slice(); const out=[];
  while (a.length && out.length < n){
    const i = Math.floor(Math.random()*a.length);
    out.push(a.splice(i,1)[0]);
  }
  return out;
}
