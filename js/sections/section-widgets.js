// js/sections/section-widgets.js
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openModal } from "../utils/modal.js";
import { loadYears, fmt, pickRandom, htm } from "../utils/helpers.js";

let EDIT = false;
export function updateWidgetEditMode(on){ EDIT = !!on; }

export async function renderWidgetSection({ db, storage, programId, mount, summary, single, years }) {
  ensureStyles(mount);

  // 연도 데이터 로드
  const yearMap = await loadYears(db, programId, years);

  // 평균 계산(예산/성과)
  const budgetAverages = calcBudgetAverage(yearMap);
  const outcomeAverages = calcOutcomeAverage(yearMap);

  const assets = (single?.design?.assetLinks || []);
  const randomAssets = pickRandom(assets, 6);

  mount.innerHTML = `
    <section class="sec">
      <div class="sec-hd"><h3>위젯 (전체 요약)</h3></div>
      <div class="grid4" id="wgGrid">
        ${tile('교육 내용 전반 요약', `
          <ul class="bul">
            ${(summary?.widgetNote || '교육 개요를 요약 입력하세요.').split('\n').slice(0,3).map(li=>`<li>${escapeHtml(li)}</li>`).join('')}
          </ul>
        `, ()=> openSummaryDetail())}

        ${tile('예산안 평균', `
          <div class="mini-table">
            <div class="row"><div>평균 총액</div><div>${fmt.format(budgetAverages.totalAvg || 0)} 원</div></div>
            ${(budgetAverages.items || []).slice(0,4).map(it=>`
              <div class="row"><div>${escapeHtml(it.name)}</div><div>${fmt.format(Math.round(it.avg || 0))} 원</div></div>
            `).join('')}
          </div>
        `, ()=> openBudgetDetail(budgetAverages, yearMap))}

        ${tile('교육 성과 전반 요약', `
          <div class="mini-table">
            <div class="row"><div>응답 수 평균</div><div>${Math.round(outcomeAverages.nAvg || 0)} 명</div></div>
            <div class="row"><div>만족도 평균(CSAT)</div><div>${(outcomeAverages.csatAvg ?? 0).toFixed(1)} 점</div></div>
            <div class="row"><div>NPS 평균</div><div>${Math.round(outcomeAverages.npsAvg ?? 0)}</div></div>
          </div>
        `, ()=> openOutcomeDetail(outcomeAverages, yearMap))}

        ${tile('포함 디자인', `
          <div class="gal">
            ${randomAssets.map(url => `<div class="thumb"><img src="${url}" alt="asset"/></div>`).join('') || `<div class="muted">첨부된 디자인 자산이 없습니다.</div>`}
          </div>
        `, ()=> openGalleryDetail(assets))}
      </div>
    </section>
  `;

  // 상세보기들
  function openSummaryDetail(){
    const content = `
      <textarea id="widgetNoteEdit" style="width:100%;min-height:260px" ${EDIT ? '' : 'readonly'}>${escapeHtml(summary?.widgetNote || '')}</textarea>
    `;
    const overlay = openModal({
      title: '교육 내용 전반 요약',
      contentHTML: content,
      footerHTML: EDIT ? `<button class="om-btn primary" id="saveWG">저장</button>` : ''
    });
    overlay.querySelector('#saveWG')?.addEventListener('click', async ()=>{
      const val = overlay.querySelector('#widgetNoteEdit').value;
      await setDoc(doc(db,'programs',programId,'meta','summary'), { widgetNote: val, updatedAt: Date.now() }, { merge:true });
      alert('저장되었습니다. 페이지 새로고침 시 반영됩니다.');
      overlay.remove();
    });
  }

  function openBudgetDetail(avg, ymap){
    const rows = [
      ['연도','항목','금액(원)']
    ];
    for (const y of Object.keys(ymap)) {
      const v = ymap[y]?.budget?.items || [];
      v.forEach(it=> rows.push([y, it.name || '', String(it.subtotal || 0)]));
    }
    const content = `
      <div style="margin-bottom:8px;color:#9bb0cf">연도별 예산 항목과 금액을 표로 확인합니다.</div>
      <div class="mini-table">
        <div class="row"><div>평균 총액</div><div>${fmt.format(avg.totalAvg || 0)} 원</div></div>
      </div>
      <div style="overflow:auto;max-height:55vh;border:1px solid #223053;border-radius:8px;margin-top:8px">
        <table class="x-table">
          ${rows.map((r,i)=>`<tr>${r.map((c,j)=> i===0? `<th>${escapeHtml(c)}</th>`:`<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}
        </table>
      </div>
    `;
    openModal({ title:'예산안 평균 상세', contentHTML: content });
  }

  function openOutcomeDetail(avg, ymap){
    const rows = [['연도','응답수','CSAT','NPS']];
    for (const y of Object.keys(ymap)) {
      const m = ymap[y]?.outcome?.surveySummary || {};
      rows.push([y, String(m.n||0), String(m.csat??''), String(m.nps??'')]);
    }
    const content = `
      <div class="mini-table" style="margin-bottom:8px">
        <div class="row"><div>응답 수 평균</div><div>${Math.round(avg.nAvg || 0)} 명</div></div>
        <div class="row"><div>CSAT 평균</div><div>${(avg.csatAvg ?? 0).toFixed(1)}</div></div>
        <div class="row"><div>NPS 평균</div><div>${Math.round(avg.npsAvg ?? 0)}</div></div>
      </div>
      <div style="overflow:auto;max-height:55vh;border:1px solid #223053;border-radius:8px">
        <table class="x-table">
          ${rows.map((r,i)=>`<tr>${r.map((c,j)=> i===0? `<th>${escapeHtml(c)}</th>`:`<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}
        </table>
      </div>
    `;
    openModal({ title:'교육 성과 전반 요약 상세', contentHTML: content });
  }

  function openGalleryDetail(all){
    const content = `
      <div class="gal gal-lg">
        ${(all||[]).map(url => `<div class="thumb"><img src="${url}" alt="asset"/></div>`).join('') || `<div class="muted">자산이 없습니다.</div>`}
      </div>
    `;
    openModal({ title:'포함 디자인 갤러리', contentHTML: content });
  }
}

function calcBudgetAverage(ymap){
  let totals = [], itemsMap = {};
  for (const y in ymap) {
    const b = ymap[y]?.budget;
    const items = b?.items || [];
    const total = items.reduce((s,it)=> s + (Number(it.subtotal)||0), 0);
    if (total) totals.push(total);
    items.forEach(it=>{
      const key = it.name || '항목';
      itemsMap[key] = itemsMap[key] || [];
      itemsMap[key].push(Number(it.subtotal)||0);
    });
  }
  const itemsAvg = Object.keys(itemsMap).map(name=>{
    const arr = itemsMap[name]; const avg = arr.reduce((s,v)=>s+v,0)/(arr.length||1);
    return { name, avg };
  }).sort((a,b)=> b.avg - a.avg);
  const totalAvg = totals.reduce((s,v)=>s+v,0)/(totals.length||1);
  return { totalAvg, items: itemsAvg };
}

function calcOutcomeAverage(ymap){
  const nArr=[], csatArr=[], npsArr=[];
  for (const y in ymap) {
    const s = ymap[y]?.outcome?.surveySummary || {};
    if (isFinite(s.n)) nArr.push(Number(s.n));
    if (isFinite(s.csat)) csatArr.push(Number(s.csat));
    if (isFinite(s.nps)) npsArr.push(Number(s.nps));
  }
  const avg = (a)=> a.reduce((s,v)=>s+v,0)/(a.length||1);
  return {
    nAvg: avg(nArr),
    csatAvg: avg(csatArr),
    npsAvg: avg(npsArr)
  };
}

function tile(title, bodyHTML, onDetail){
  return `
    <article class="wg-card">
      <div class="wg-hd">${title}</div>
      <div class="wg-bd">${bodyHTML}</div>
      <div class="wg-ft"><button class="btn small wg-detail">상세 보기</button></div>
    </article>
  `;
}

function ensureStyles(mount){
  if (document.getElementById('wg-style')) return;
  const s = document.createElement('style'); s.id='wg-style';
  s.textContent = `
  .sec{margin:12px 0}
  .grid4{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  @media (min-width:1100px){ .grid4{grid-template-columns:repeat(4,minmax(0,1fr));} }
  .wg-card{background:#0e1629;border:1px solid #223053;border-radius:12px;display:flex;flex-direction:column}
  .wg-hd{padding:10px 12px;font-weight:700;color:#eaf1ff;border-bottom:1px solid #223053}
  .wg-bd{padding:12px;min-height:130px;color:#cdd9f2}
  .wg-ft{display:flex;justify-content:flex-end;padding:8px 12px;border-top:1px solid #223053}
  .btn.small{padding:4px 8px;border:1px solid #223053;background:#162138;color:#eaf1ff;border-radius:8px;cursor:pointer}

  .mini-table{display:grid;gap:6px}
  .mini-table .row{display:grid;grid-template-columns:1fr auto;gap:8px;background:#0b1426;border:1px solid #223053;border-radius:8px;padding:6px 8px}
  .gal{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
  .gal .thumb{aspect-ratio:4/3;overflow:hidden;border-radius:8px;border:1px solid #223053;background:#0b1426;display:flex;align-items:center;justify-content:center}
  .gal .thumb img{width:100%;height:100%;object-fit:cover}
  .gal-lg{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));}
  .muted{color:#93a7c8}
  .bul{margin:0;padding-left:18px}
  .x-table{width:100%;border-collapse:collapse}
  .x-table th,.x-table td{border-bottom:1px solid #223053;padding:8px 10px;text-align:left}
  `;
  document.head.appendChild(s);

  // 상세보기 바인딩을 위해 위임
  mount?.addEventListener('click', (e)=>{
    if (!(e.target instanceof HTMLElement)) return;
    if (!e.target.classList.contains('wg-detail')) return;
    // 타이틀 텍스트로 분기
    const card = e.target.closest('.wg-card');
    const title = card?.querySelector('.wg-hd')?.textContent?.trim() || '';
    const order = ['교육 내용 전반 요약','예산안 평균','교육 성과 전반 요약','포함 디자인'];
    const idx = order.indexOf(title);
    // 클릭은 section-widgets.js 상단에서 각각의 핸들러로 교체되어야 하므로 여기서는 noop
  });
}

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
