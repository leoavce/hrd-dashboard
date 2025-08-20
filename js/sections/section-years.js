// js/sections/section-years.js
import { loadYears, fmt } from "../utils/helpers.js";
import { openModal } from "../utils/modal.js";

let EDIT = false;
export function updateYearEditMode(on){ EDIT = !!on; }

export async function renderYearSection({ db, storage, programId, mount, years }) {
  ensureStyles();
  const data = await loadYears(db, programId, years);

  mount.innerHTML = `
    <section class="sec">
      <div class="sec-hd"><h3>년도별 페이지</h3></div>

      ${years.map(y=> oneYearBlock(y, data[y] || {})).join('')}
    </section>
  `;

  // 상세보기 버튼 바인딩
  mount.querySelectorAll('.see-detail').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const y = btn.dataset.year;
      const kind = btn.dataset.kind;
      openDetail(kind, y, data[y] || {});
    });
  });

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

function oneYearBlock(y, v){
  const outlinePreview = (v?.content?.outline || '').split('\n').slice(0,6).map(s=>`<li>${escapeHtml(s)}</li>`).join('') || '<li>내용 미입력</li>';
  const budgetPreview = (v?.budget?.items||[]).slice(0,5).map(it=>`
    <div class="row"><div>${escapeHtml(it.name||'항목')}</div><div>${fmt.format(Number(it.subtotal||0))} 원</div></div>
  `).join('') || '<div class="muted">항목 없음</div>';
  const outcomeS = v?.outcome?.surveySummary || {};
  const insights = (v?.outcome?.insights||[]).slice(0,3).map(it=>`<li>${escapeHtml(it.title||'')}</li>`).join('') || '<li>없음</li>';
  const assets = (v?.design?.assetLinks||[]).slice(0,6).map(u=>`<div class="thumb"><img src="${u}" /></div>`).join('') || '<div class="muted">자산 없음</div>';

  return `
    <section class="yr">
      <div class="yr-cap">${y}</div>

      <div class="yr-box">
        <div class="yr-hd">교육 내용</div>
        <ul class="bul">${outlinePreview}</ul>
        <div class="ft"><button class="btn small see-detail" data-year="${y}" data-kind="content">상세 보기</button></div>
      </div>

      <div class="yr-box">
        <div class="yr-hd">교육 예산</div>
        <div class="mini-table">${budgetPreview}</div>
        <div class="ft"><button class="btn small see-detail" data-year="${y}" data-kind="budget">상세 보기</button></div>
      </div>

      <div class="yr-box">
        <div class="yr-hd">교육 성과</div>
        <div class="mini-table">
          <div class="row"><div>응답수</div><div>${outcomeS.n||0}</div></div>
          <div class="row"><div>CSAT</div><div>${outcomeS.csat ?? '-'}</div></div>
          <div class="row"><div>NPS</div><div>${outcomeS.nps ?? '-'}</div></div>
        </div>
        <ul class="bul" style="margin-top:6px">${insights}</ul>
        <div class="ft"><button class="btn small see-detail" data-year="${y}" data-kind="outcome">상세 보기</button></div>
      </div>

      <div class="yr-box">
        <div class="yr-hd">교육 디자인</div>
        <div class="gal">${assets}</div>
        <div class="ft"><button class="btn small see-detail" data-year="${y}" data-kind="design">상세 보기</button></div>
      </div>
    </section>
  `;
}

function ensureStyles(){
  if (document.getElementById('yr-style')) return;
  const s = document.createElement('style'); s.id='yr-style';
  s.textContent = `
    .yr{background:#0e1629;border:1px solid #223053;border-radius:12px;padding:12px;margin:12px 0}
    .yr-cap{font-weight:800;color:#eaf1ff;margin-bottom:8px}
    .yr-box{background:#0b1426;border:1px solid #223053;border-radius:10px;padding:10px;margin-top:10px}
    .yr-hd{font-weight:700;margin-bottom:6px;color:#eaf1ff}
    .mini-table .row{display:grid;grid-template-columns:1fr auto;gap:8px;background:#0b1426;border:1px solid #223053;border-radius:8px;padding:6px 8px;margin-bottom:6px}
    .gal{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
    @media (min-width:1000px){ .gal{grid-template-columns:repeat(6,1fr);} }
    .gal .thumb{aspect-ratio:4/3;overflow:hidden;border-radius:8px;border:1px solid #223053;background:#0b1426;display:flex;align-items:center;justify-content:center}
    .gal .thumb img{width:100%;height:100%;object-fit:cover}
    .bul{margin:0;padding-left:18px}
    .btn.small{padding:4px 8px;border:1px solid #223053;background:#162138;color:#eaf1ff;border-radius:8px;cursor:pointer}
    .muted{color:#93a7c8}
  `;
  document.head.appendChild(s);
}

function table(headers, rows){
  return `
    <table class="x-table">
      <tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr>
      ${rows.map(r=>`<tr>${r.map(c=>`<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}
    </table>
  `;
}
function label(kind){ return ({content:'교육 내용',budget:'교육 예산',outcome:'교육 성과',design:'교육 디자인'})[kind] || kind; }
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
