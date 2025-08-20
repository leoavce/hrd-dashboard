// js/sections/section-widgets.js
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openModal } from "../utils/modal.js";
import { loadYears, fmt, pickRandom } from "../utils/helpers.js";

let EDIT = false;
export function updateWidgetEditMode(on){ EDIT = !!on; }

export async function renderWidgetSection({ db, storage, programId, mount, summary, single, years }) {
  ensureStyles();

  const yearMap = await loadYears(db, programId, years);
  const budgetAverages  = calcBudgetAverage(yearMap);
  const outcomeAverages = calcOutcomeAverage(yearMap);
  const assets = (single?.design?.assetLinks || []);
  const randomAssets = pickRandom(assets, 6);

  mount.innerHTML = `
    <section class="sec sec-wg">
      <div class="sec-hd"><h3>위젯 (전체 요약)</h3></div>
      <div class="grid4">
        ${tile('교육 내용 전반 요약', `
          <ul class="bul">
            ${(summary?.widgetNote || '교육 개요 요약을 입력하세요.').split('\n').slice(0,3).map(li=>`<li>${esc(li)}</li>`).join('')}
          </ul>
        `,'openSummary')}

        ${tile('예산안 평균', `
          <div class="mini-table">
            <div class="row"><div>평균 총액</div><div>${fmt.format(budgetAverages.totalAvg || 0)} 원</div></div>
            ${(budgetAverages.items || []).slice(0,4).map(it=>`
              <div class="row"><div>${esc(it.name)}</div><div>${fmt.format(Math.round(it.avg||0))} 원</div></div>
            `).join('')}
          </div>
        `,'openBudget')}

        ${tile('교육 성과 전반 요약', `
          <div class="mini-table">
            <div class="row"><div>응답 수 평균</div><div>${Math.round(outcomeAverages.nAvg || 0)} 명</div></div>
            <div class="row"><div>CSAT 평균</div><div>${(outcomeAverages.csatAvg ?? 0).toFixed(1)}</div></div>
            <div class="row"><div>NPS 평균</div><div>${Math.round(outcomeAverages.npsAvg ?? 0)}</div></div>
          </div>
        `,'openOutcome')}

        ${tile('포함 디자인', `
          <div class="gal">
            ${randomAssets.map(url => `<div class="thumb"><img src="${url}" alt="asset"/></div>`).join('') || `<div class="muted">디자인 자산이 없습니다.</div>`}
          </div>
        `,'openGallery')}
      </div>
    </section>
  `;

  // 상세 모달들
  mount.querySelector('[data-act="openSummary"]').addEventListener('click', ()=>{
    const content = `
      <textarea id="wgTxt" style="width:100%;min-height:280px" ${EDIT ? '' : 'readonly'}>${esc(summary?.widgetNote || '')}</textarea>
    `;
    const ov = openModal({
      title:'교육 내용 전반 요약',
      contentHTML:content,
      footerHTML: EDIT ? `<button class="om-btn primary" id="wgSave">저장</button>` : ''
    });
    ov.querySelector('#wgSave')?.addEventListener('click', async ()=>{
      const val = ov.querySelector('#wgTxt').value;
      await setDoc(doc(db,'programs',programId,'meta','summary'), { widgetNote: val, updatedAt: Date.now() }, { merge:true });
      alert('저장되었습니다.'); ov.remove();
    });
  });

  mount.querySelector('[data-act="openBudget"]').addEventListener('click', ()=>{
    const rows = [['연도','항목','금액(원)']];
    for (const y of years) {
      const v = yearMap[y]?.budget?.items || [];
      v.forEach(it=> rows.push([y, it.name||'', fmt.format(Number(it.subtotal||0))]));
    }
    const content = `
      <div class="mini-table" style="margin-bottom:8px">
        <div class="row"><div><b>평균 총액</b></div><div><b>${fmt.format(budgetAverages.totalAvg||0)} 원</b></div></div>
      </div>
      <div class="tbl-wrap">
        <table class="x-table">
          ${rows.map((r,i)=>`<tr>${r.map((c)=> i===0? `<th>${esc(c)}</th>`:`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}
        </table>
      </div>
    `;
    openModal({ title:'예산안 평균 상세', contentHTML:content });
  });

  mount.querySelector('[data-act="openOutcome"]').addEventListener('click', ()=>{
    const rows = [['연도','응답수','CSAT','NPS']];
    for (const y of years) {
      const s = yearMap[y]?.outcome?.surveySummary || {};
      rows.push([y, String(s.n||0), String(s.csat??''), String(s.nps??'')]);
    }
    const content = `
      <div class="mini-table" style="margin-bottom:8px">
        <div class="row"><div>응답 수 평균</div><div>${Math.round(outcomeAverages.nAvg||0)} 명</div></div>
        <div class="row"><div>CSAT 평균</div><div>${(outcomeAverages.csatAvg ?? 0).toFixed(1)}</div></div>
        <div class="row"><div>NPS 평균</div><div>${Math.round(outcomeAverages.npsAvg ?? 0)}</div></div>
      </div>
      <div class="tbl-wrap">
        <table class="x-table">
          ${rows.map((r,i)=>`<tr>${r.map((c)=> i===0? `<th>${esc(c)}</th>`:`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}
        </table>
      </div>
    `;
    openModal({ title:'교육 성과 전반 요약 상세', contentHTML:content });
  });

  mount.querySelector('[data-act="openGallery"]').addEventListener('click', ()=>{
    const content = `
      <div class="gal gal-lg">
        ${(assets||[]).map(url => `<div class="thumb"><img src="${url}" alt="asset"/></div>`).join('') || `<div class="muted">자산이 없습니다.</div>`}
      </div>
    `;
    openModal({ title:'포함 디자인 갤러리', contentHTML:content });
  });
}

function tile(title, body, act){
  return `
    <article class="wg-card">
      <div class="wg-hd">${title}</div>
      <div class="wg-bd">${body}</div>
      <div class="wg-ft"><button class="btn small" data-act="${act}">상세 보기</button></div>
    </article>
  `;
}

function calcBudgetAverage(ymap){
  let totals=[], itemsMap={};
  for(const y in ymap){
    const items = ymap[y]?.budget?.items||[];
    const total = items.reduce((s,it)=> s + (Number(it.subtotal)||0), 0);
    if (total) totals.push(total);
    items.forEach(it=>{
      const k = it.name||'항목';
      (itemsMap[k] ||= []).push(Number(it.subtotal)||0);
    });
  }
  const itemsAvg = Object.keys(itemsMap).map(name=>{
    const arr = itemsMap[name]; const avg = arr.reduce((s,v)=>s+v,0)/(arr.length||1);
    return { name, avg };
  }).sort((a,b)=> b.avg-a.avg);
  const totalAvg = totals.reduce((s,v)=>s+v,0)/(totals.length||1);
  return { totalAvg, items: itemsAvg };
}
function calcOutcomeAverage(ymap){
  const n=[], cs=[], np=[];
  for(const y in ymap){
    const s = ymap[y]?.outcome?.surveySummary || {};
    if (isFinite(s.n)) n.push(+s.n);
    if (isFinite(s.csat)) cs.push(+s.csat);
    if (isFinite(s.nps)) np.push(+s.nps);
  }
  const avg = a => a.reduce((s,v)=>s+v,0)/(a.length||1);
  return { nAvg:avg(n), csatAvg:avg(cs), npsAvg:avg(np) };
}
function ensureStyles(){
  if (document.getElementById('wg-style')) return;
  const s = document.createElement('style'); s.id='wg-style';
  s.textContent = `.sec-hd h3{margin:0 0 8px;color:#d6e6ff;font-weight:800}`;
  document.head.appendChild(s);
}
const esc = (s)=> String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
