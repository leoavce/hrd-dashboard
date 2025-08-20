// js/sections/section-items.js
import { loadYears, fmt, htm } from "../utils/helpers.js";
import { openModal } from "../utils/modal.js";

let EDIT = false;
export function updateItemEditMode(on){ EDIT = !!on; }

export async function renderItemSection({ db, storage, programId, mount, years }) {
  ensureStyles();
  const data = await loadYears(db, programId, years);

  mount.innerHTML = `
    <section class="sec">
      <div class="sec-hd"><h3>항목별 페이지</h3></div>

      ${block('교육 내용', 'content')}
      ${block('교육 예산', 'budget')}
      ${block('교육 성과', 'outcome')}
      ${block('교육 디자인', 'design')}
    </section>
  `;

  // 4개 블록 초기화
  initCarousel('content', renderContentCard);
  initCarousel('budget', renderBudgetCard);
  initCarousel('outcome', renderOutcomeCard);
  initCarousel('design', renderDesignCard);

  function initCarousel(kind, renderer){
    const host = mount.querySelector(`[data-kind="${kind}"] .cards`);
    const yBox = mount.querySelector(`[data-kind="${kind}"] .years`);
    let index = 0; // 시작: 0~2 (최대 3개 보임)

    function getYearSlice(){
      const slice = years.slice(index, index+3);
      return slice.length ? slice : years.slice(Math.max(0, years.length-3));
    }

    function paint(){
      const slice = getYearSlice();
      host.innerHTML = slice.map(y => `<article class="it-card" data-year="${y}"></article>`).join('');
      yBox.textContent = slice.join('  |  ');
      host.querySelectorAll('.it-card').forEach((el)=>{
        const y = el.dataset.year;
        el.innerHTML = renderer(y, data[y] || {});
        // 상세보기 클릭 → 년도별 상세와 동일한 모달 형식
        el.querySelector('.see-detail')?.addEventListener('click', ()=>{
          openDetail(kind, y, data[y] || {});
        });
      });
    }

    mount.querySelector(`[data-kind="${kind}"] .nav.prev`).addEventListener('click', ()=>{
      index = Math.max(0, index - 1);
      paint();
    });
    mount.querySelector(`[data-kind="${kind}"] .nav.next`).addEventListener('click', ()=>{
      index = Math.min(years.length-3, index + 1);
      paint();
    });

    paint();
  }

  // 상세보기(항목별 == 년도별 해당 항목 상세와 동일)
  function openDetail(kind, y, v){
    const title = `${y} ${label(kind)} 상세`;
    let content = '';
    if (kind==='content'){
      content = `<div class="preview"><pre>${escapeHtml(v?.content?.outline || '내용이 없습니다.')}</pre></div>`;
    } else if (kind==='budget'){
      const rows = (v?.budget?.items||[]).map(it=> [it.name||'', fmt.format(Number(it.unitCost||0)), String(it.qty||0), fmt.format(Number(it.subtotal||0)), it.note||'']);
      content = table(['항목','단가','수량','소계','비고'], rows);
    } else if (kind==='outcome'){
      const s = v?.outcome?.surveySummary || {};
      const kpis = v?.outcome?.kpis || [];
      const insights = v?.outcome?.insights || [];
      content = `
        <div class="mini-table" style="margin-bottom:8px">
          <div class="row"><div>응답수</div><div>${s.n||0}</div></div>
          <div class="row"><div>CSAT</div><div>${s.csat ?? '-'}</div></div>
          <div class="row"><div>NPS</div><div>${s.nps ?? '-'}</div></div>
        </div>
        <h4>KPI</h4>
        ${table(['지표','값','목표','상태'], kpis.map(k=>[k.name||'', k.value||'', k.target||'', k.status||'']))}
        <h4 style="margin-top:10px">인사이트</h4>
        <ul class="bul">${insights.map(it=>`<li>${escapeHtml(it.title||'')}: ${escapeHtml(it.detail||'')}</li>`).join('')||'<li>없음</li>'}</ul>
      `;
    } else if (kind==='design'){
      const assets = v?.design?.assetLinks || [];
      content = `
        <div class="gal gal-lg">
          ${(assets||[]).map(url => `<div class="thumb"><img src="${url}" alt="asset"/></div>`).join('') || `<div class="muted">자산이 없습니다.</div>`}
        </div>
      `;
    }
    openModal({ title, contentHTML: content });
  }
}

function block(title, kind){
  return `
    <section class="it-sec" data-kind="${kind}">
      <div class="it-hd">
        <div class="l">${title}</div>
        <div class="r">
          <button class="nav prev">◀</button>
          <span class="years"></span>
          <button class="nav next">▶</button>
        </div>
      </div>
      <div class="cards"></div>
    </section>
  `;
}

function renderContentCard(y, v){
  const ol = (v?.content?.outline || '').split('\n').slice(0,3).map(s=>`<li>${escapeHtml(s)}</li>`).join('');
  return `
    <div class="cap">${y}</div>
    <ul class="bul">${ol || '<li>내용 미입력</li>'}</ul>
    <div class="ft"><button class="btn small see-detail">상세 보기</button></div>
  `;
}
function renderBudgetCard(y, v){
  const items=(v?.budget?.items||[]).slice(0,3);
  const total = (v?.budget?.items||[]).reduce((s,it)=>s+(Number(it.subtotal)||0),0);
  return `
    <div class="cap">${y}</div>
    <div class="mini-table">
      ${items.map(it=>`<div class="row"><div>${escapeHtml(it.name||'항목')}</div><div>${fmt.format(Number(it.subtotal||0))} 원</div></div>`).join('') || '<div class="muted">항목 없음</div>'}
      <div class="row"><div><strong>합계</strong></div><div><strong>${fmt.format(total)} 원</strong></div></div>
    </div>
    <div class="ft"><button class="btn small see-detail">상세 보기</button></div>
  `;
}
function renderOutcomeCard(y, v){
  const s = v?.outcome?.surveySummary || {};
  const kpis = (v?.outcome?.kpis||[]).slice(0,2);
  return `
    <div class="cap">${y}</div>
    <div class="mini-table">
      <div class="row"><div>응답수</div><div>${s.n||0}</div></div>
      <div class="row"><div>CSAT</div><div>${s.csat ?? '-'}</div></div>
      <div class="row"><div>NPS</div><div>${s.nps ?? '-'}</div></div>
    </div>
    <ul class="bul" style="margin-top:6px">${kpis.map(k=>`<li>${escapeHtml(k.name||'')}: ${escapeHtml(k.value||'')}</li>`).join('')}</ul>
    <div class="ft"><button class="btn small see-detail">상세 보기</button></div>
  `;
}
function renderDesignCard(y, v){
  const assets = (v?.design?.assetLinks||[]).slice(0,3);
  return `
    <div class="cap">${y}</div>
    <div class="gal">
      ${assets.map(u=>`<div class="thumb"><img src="${u}" /></div>`).join('') || '<div class="muted">자산 없음</div>'}
    </div>
    <div class="ft"><button class="btn small see-detail">상세 보기</button></div>
  `;
}

function table(headers, rows){
  return `
    <table class="x-table">
      <tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr>
      ${rows.map(r=>`<tr>${r.map(c=>`<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}
    </table>
  `;
}

function ensureStyles(){
  if (document.getElementById('it-style')) return;
  const s = document.createElement('style'); s.id='it-style';
  s.textContent = `
    .it-sec{margin:14px 0;background:#0e1629;border:1px solid #223053;border-radius:12px;padding:10px}
    .it-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;color:#eaf1ff}
    .it-hd .l{font-weight:700}
    .it-hd .r{display:flex;gap:8px;align-items:center}
    .it-hd .nav{border:1px solid #223053;background:#162138;color:#eaf1ff;border-radius:8px;padding:4px 8px;cursor:pointer}
    .cards{display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:8px}
    @media (min-width:900px){ .cards{grid-template-columns:repeat(3,minmax(0,1fr));} }
    .it-card{background:#0b1426;border:1px solid #223053;border-radius:10px;padding:10px;display:flex;flex-direction:column}
    .it-card .cap{font-weight:700;margin-bottom:6px;color:#eaf1ff}
    .mini-table .row{display:grid;grid-template-columns:1fr auto;gap:8px;background:#0b1426;border:1px solid #223053;border-radius:8px;padding:6px 8px;margin-bottom:6px}
    .gal{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
    .gal .thumb{aspect-ratio:4/3;overflow:hidden;border-radius:8px;border:1px solid #223053;background:#0b1426;display:flex;align-items:center;justify-content:center}
    .gal .thumb img{width:100%;height:100%;object-fit:cover}
    .bul{margin:0;padding-left:18px}
    .ft{display:flex;justify-content:flex-end;margin-top:auto}
    .btn.small{padding:4px 8px;border:1px solid #223053;background:#162138;color:#eaf1ff;border-radius:8px;cursor:pointer}
    .x-table{width:100%;border-collapse:collapse}
    .x-table th,.x-table td{border-bottom:1px solid #223053;padding:8px 10px;text-align:left}
    .muted{color:#93a7c8}
  `;
  document.head.appendChild(s);
}

function label(kind){ return ({content:'교육 내용',budget:'교육 예산',outcome:'교육 성과',design:'교육 디자인'})[kind] || kind; }
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
