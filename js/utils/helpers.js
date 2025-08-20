// js/utils/helpers.js
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/** 연도 문서 로드 */
export async function loadYearDoc(db, programId, y) {
  const snap = await getDoc(doc(db,'programs',programId,'years',y));
  return snap.exists() ? snap.data() : null;
}

/** 여러 연도 로드 */
export async function loadYears(db, programId, years) {
  const out = {};
  for (const y of years) {
    out[y] = await loadYearDoc(db, programId, y);
  }
  return out;
}

/** 숫자 포맷 */
export const fmt = new Intl.NumberFormat('ko-KR');

/** 배열 랜덤 n개 */
export function pickRandom(arr, n=4) {
  const a = [...(arr||[])];
  a.sort(()=> Math.random()-0.5);
  return a.slice(0, n);
}

/** dom 유틸 */
export function htm(html){ const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstElementChild; }
