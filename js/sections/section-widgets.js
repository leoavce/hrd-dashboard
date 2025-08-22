// js/sections/section-widgets.js
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { fmt } from "../utils/helpers.js";

let EDIT = false;
export function updateWidgetEditMode(on){ EDIT = !!on; }

/**
 * schema.sections.widgets = ['summary','avgBudget','outcome','gallery'] 중 일부
 */
export async function renderWidgetSection({ db, storage, programId, mount, summary, single, years, schema }){
  const enabled = (schema?.sections?.widgets || ['summary','avgBudget','outcome','gallery']);
  ensureStyle();

  async function pullYears(){
    const out = {};
    for (const y of years){
      const snap = await getDoc(doc(db,'programs',programId,'years',y));
      if(snap.exists()) out[y] = snap.data();
    }
    return out;
  }
  let yearsData = await pullYears();

  mount.innerHTML = `
    <div class="sec-wg">
      <div class="grid4">
        ${enabled.includes('summary')   ? wgCard('교육 내용 전반 요약','widget:summary', `<div class="bul"><li>${esc(summary?.widgetNote||'요약 위젯(에디트로 수정)')}</li></div>`) : '' }
        ${enabled.includes('avgBudget') ? wgCard('예산안 평균','widget:avg',   `<div class="mini-table" id="wgAvg"></div>`) : '' }
        ${enabled.includes('outcome')   ? wgCard('교육 성과 전반 요약','widget:outcome', `<div class="mini-table" id="wgOut"></div>`) : '' }
        ${enabled.includes('gallery')   ? wgCard('포함 디자인','widget:gallery', `<div class="gal" id="wgGal"></div>`) : '' }
      </div>
    </div>
  `;

  // 초기 그리기
  paintBudgetAvg(); paintOutcome(); paintGallery();

  // 데이터 갱신 시 즉시 다시 계산
  const onUpdated = async (e)=>{
    if(!e?.detail || e.detail.programId !== programId) return;
    const y = e.detail.year;
    if(y){ // 해당 연도만 새로 가져와 병합
      const snap = await getDoc(doc(db,'programs',programId,'years',y));
      if(snap.exists()) yearsData[y] = snap.data();
    }else{
      yearsData = await pullYears();
    }
    paintBudgetAvg(); paintOutcome(); paintGallery();
  };
  window.addEventListener('hrd:data-updated', onUpdated);

  // ---- painters ----
  function paintBudgetAvg(){
    const box = mount.querySelector('#wgAvg'); if(!box) return;
    // 각 연도 total 합을 계산
    const vec = years.map(y=>{
      const items = yearsData?.[y]?.budget?.items || [];
      const sum = items.reduce((s,it)=> s + ((+it.unitCost||0)*(+it.qty||0)), 0);
      return { y, sum };
    }).filter(x=>x.sum>0);
    const avg = vec.length ? Math.round(vec.reduce((s,x)=>s+x.sum,0)/vec.length) : 0;
    box.innerHTML = `
      <div class="row"><div>평균 총액</div><div>${fmt.format(avg)} 원</div></div>
      ${vec.map(x=>`<div class="row"><div>${x.y}</div><div>${fmt.format(x.sum)} 원</div></div>`).join('') || '<div class="muted small">데이터 없음</div>'}
    `;
  }
  function paintOutcome(){
    const box = mount.querySelector('#wgOut'); if(!box) return;
    // 간단 평균(응답수/CSAT/NPS)
    const surv = years.map(y=> yearsData?.[y]?.outcome?.surveySummary || {});
    const nAvg = avg(surv.map(s=> +s.n||0));
    const csAvg= avg(surv.map(s=> +s.csat||0));
    const npAvg= avg(surv.map(s=> +s.nps||0));
    box.innerHTML = `
      <div class="row"><div>응답 수 평균</div><div>${nAvg}</div></div>
      <div class="row"><div>CSAT 평균</div><div>${Number.isFinite(csAvg)?csAvg.toFixed(1):'-'}</div></div>
      <div class="row"><div>NPS 평균</div><div>${Number.isFinite(npAvg)?npAvg.toFixed(1):'-'}</div></div>
    `;
  }
  function paintGallery(){
    const box = mount.querySelector('#wgGal'); if(!box) return;
    const imgs = [];
    years.forEach(y=>{
      (yearsData?.[y]?.design?.assetLinks||[]).slice(0,3).forEach(u=> imgs.push(u));
    });
    box.innerHTML = imgs.length
      ? imgs.slice(0,6).map(u=>`<div class="thumb"><img src="${u}"></div>`).join('')
      : '<div class="muted small">디자인 자산이 없습니다.</div>';
  }
}

function wgCard(title, id, body){
  return `
    <article class="wg-card" data-id="${id}">
      <div class="wg-hd">${title}</div>
      <div class="wg-bd">${body}</div>
      <div class="wg-ft"><button class="btn small see-detail hidden">상세 보기</button></div>
    </article>
  `;
}

function ensureStyle(){
  if(document.getElementById('wg-style')) return;
  const s=document.createElement('style'); s.id='wg-style';
  s.textContent=``; document.head.appendChild(s);
}
const esc = (s)=> String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const avg = (arr)=> arr.length? Math.round(arr.reduce((s,v)=>s+v,0)/arr.length) : 0;
