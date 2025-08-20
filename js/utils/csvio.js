// js/utils/csvio.js

/** 간단 CSV 파서 (따옴표/콤마 기본 처리) */
export function parseCSV(text) {
  const rows = [];
  let cur = '', row = [], q = false;
  for (let i=0; i<text.length; i++){
    const c = text[i];
    if (c === '"') {
      if (q && text[i+1] === '"'){ cur+='"'; i++; }
      else q = !q;
    } else if (c === ',' && !q) {
      row.push(cur); cur='';
    } else if ((c === '\n' || c === '\r') && !q) {
      if (cur.length || row.length) { row.push(cur); rows.push(row); row=[]; cur=''; }
    } else {
      cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** 2차원 배열 → CSV 문자열 */
export function toCSV(rows) {
  const esc = (s)=> `"${String(s??'').replace(/"/g,'""')}"`;
  return rows.map(r => r.map(esc).join(',')).join('\n');
}

/** 파일 input에서 텍스트 읽기 */
export function readTextFromFile(file) {
  return new Promise((res, rej)=>{
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result||''));
    fr.onerror = () => rej(fr.error);
    fr.readAsText(file, 'utf-8');
  });
}
