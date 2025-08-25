// js/sections/section-widgets.js
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openModal } from "../utils/modal.js";
import { loadYears, fmt, pickRandom } from "../utils/helpers.js";

let EDIT = false;
export function updateWidgetEditMode(on){ EDIT = !!on; }

/**
 * schema.sections.widgets = ['summary','budget','outcome','design'] 중 일부
 */
export async function renderWidgetSection({ db, storage, programId, mount, summary, single, years, schema }) {
  ensureStyle();
  const enabled = (schema?.sections?.widgets || ['summary','budget','outcome','design']);

  // 원본 맵
  let yearMap = await loadYears(db, programId, years);
  // 프리뷰 오버라이드(편집 중 미리보기)
  const preview = {};

  /* ===== 프리뷰 이벤트(편집 즉시 반영) ===== */
  const onPreview = (e)=>{
    const d = e.detail||{};
    if (d.programId !== programId) return;
    if (d.year && d.data){
      preview[d.year] = d.data; // 예: { budget:{items:...}, design:{assets:[...]}, ... }
      paint();
    }
  };
  const onPreviewClear = (e)=>{
    const d = e.detail||{};
    if (d.programId !== programId) return;
    if (d.year) delete preview[d.year]; else Object.keys(preview).forEach(k=> delete preview[k]);
    paint();
  };
  window.addEventListener('hrd:preview-year', onPreview);
  window.addEventListener('hrd:preview-clear', onPreviewClear);

  // 저장 이후 실제 데이터가 바뀐 경우 재로딩
  const NS = `hrd-year-updated-widgets-${programId}`;
  window.removeEventListener('hrd:year-updated', window[NS]);
  window[NS] = async (e)=>{
    if (e?.detail?.programId !== programId) return;
    yearMap = await loadYears(db, programId, years);
    paint();
  };
  window.addEventListener('hrd:year-updated', window[NS]);

  function mergedYearMap(){
    const m = { ...yearMap };
    Object.keys(preview).forEach(y=>{
      m[y] = { ...(m[y]||{}), ...(preview[y]||{}) };
    });
    return m;
  }

  function mergedAssetsFrom(ymap){
    // 각 연도의 design.assets(type:'img') 및 레거시 assetLinks 수집
    const list = [];
    for (const y of years){
      const d = (ymap[y]?.design)||{};
      if (Array.isArray(d.assets)){
        d.assets.forEach(a=>{ if (a?.type==='img' && a.url) list.push(a.url); });
      }
      if (Array.isArray(d.assetLinks)){
        d.assetLinks.forEach(u=> list.push(u));
      }
    }
    // 단일문서(레거시)도 보조로 포함
    if (Array.isArray(single?.design?.assetLinks)){
      single.design.assetLinks.forEach(u=> list.push(u));
    }
    return list;
  }

  function paint(){
    const ymap = mergedYearMap();
    const budgetAverages  = calcBudgetAverage(ymap);
    const outcomeAverages = calcOutcomeAverage(ymap);

    const gallery = mergedAssetsFrom(ymap);
    const randomAssets = pickRandom(gallery, 6);

    const tiles = [];
    if (enabled.includes('summary')) tiles.push(tile('교육 내용 전반 요약', `
      <ul class="bul">
        ${(summary?.widgetNote || '교육 개요 요약을 입력하세요.').split('\n').slice(0,3).map(li=>`<li>${esc(li)}</li>`).join('')}
      </ul>
    `,'openSummary'));

    if (enabled.includes('budget')) tiles.push(tile('예산안 평균', `
      <div class="mini-table">
        <div class="row"><div>평균 총액</div><div>${fmt.format(Math.round(budgetAverages.totalAvg || 0))} 원</div></div>
        ${(budgetAverages.items || []).slice(0,4).map(it=>`
          <div class="row"><div>${esc(it.name)}</div><div>${fmt.format(Math.round(it.avg||0))} 원</div></div>
        ).join('')}
      </div>
    `,'openBudget'));

    if (enabled.includes('outcome')) tiles.push(tile('교육 성과 전반 요약', `
      <div class="mini-table">
        <div class="row"><div>응답 수 평균</div><div>${Math.round(outcomeAverages.nAvg || 0)} 명</div></div>
        <div class="row"><div>CSAT 평균</div><div>${(outcomeAverages.csatAvg ?? 0).toFixed(1)}</div></div>
        <div class="row"><div>NPS 평균</div><div>${Math.round(outcomeAverages.npsAvg ?? 0)}</div></div>
      </div>
    `,'openOutcome'));

    if (enabled.includes('design')) tiles.push(tile('포함 디자인', `
      <div class="gal">
        ${randomAssets.map(url => `<div class="thumb"><img src="${url}" alt="asset"/></div>`).join('') || `<div class="muted">디자인 자산이 없습니다.</div>`}
      </div>
    `,'openGallery'));

    mount.innerHTML = `<div class="sec sec-wg"><div class="grid4">${tiles.join('')}</div></div>`;

    // 상세 모달들
    bindModals(ymap, gallery, budgetAverages, outcomeAverages, years);
  }

  function bindModals(ymap, gallery, budgetAverages, outcomeAverages, years){
    // 요약
    mount.querySelector('[data-act="openSummary"]')?.addEventListener('click', ()=>{
      const content = `<textarea id="wgTxt" style="width:100%;min-height:280px" ${EDIT ? '' : 'readonly'}>${esc(summary?.widgetNote || '')}</textarea>`;
      const ov = openModal({ title:'교육 내용 전반 요약', contentHTML:content, footerHTML: EDIT ? `<button class="om-btn primary" id="wgSave">저장</button>` : '' });
      ov.querySelector('#wgSave')?.addEventListener('click', async ()=>{
        const val = ov.querySelector('#wgTxt').value;
        await setDoc(doc(db,'programs',programId,'meta','summary'), { widgetNote: val, updatedAt: Date.now() }, { merge:true });
        alert('저장되었습니다.'); ov.remove();
      });
    });

    // 예산 평균 상세
    mount.querySelector('[data-act="openBudget"]')?.addEventListener('click', ()=>{
      const rows = [['연도','항목','금액(원)']];
      for (const y of years) {
        const v = (ymap[y]?.budget?.items || []);
        v.forEach(it=> rows.push([y, it.name||'', fmt.format(Number(it.subtotal||0))]));
      }
      const content = `
        <div class="mini-table" style="margin-bottom:8px">
          <div class="row"><div><b>평균 총액</b></div><div><b>${fmt.format(Math.round(budgetAverages.totalAvg||0))} 원</b></div></div>
        </div>
        <table class="x-table">${rows.map((r,i)=>`<tr>${r.map(c=> i? `<td>${esc(c)}</td>`:`<th>${esc(c)}</th>`).join('')}</tr>`).join('')}</table>
      `;
      openModal({ title:'예산안 평균 상세', contentHTML:content });
    });

    // 성과 평균 상세
    mount.querySelector('[data-act="openOutcome"]')?.addEventListener('click', ()=>{
      const rows = [['연도','응답수','CSAT','NPS']];
      for (const y of years) {
        const s = ymap[y]?.outcome?.surveySummary || {};
        rows.push([y, String(s.n||0), String(s.csat??''), String(s.nps??'')]);
      }
      const content = `
        <div class="mini-table" style="margin-bottom:8px">
          <div class="row"><div>응답 수 평균</div><div>${Math.round(outcomeAverages.nAvg||0)} 명</div></div>
          <div class="row"><div>CSAT 평균</div><div>${(outcomeAverages.csatAvg ?? 0).toFixed(1)}</div></div>
          <div class="row"><div>NPS 평균</div><div>${Math.round(outcomeAverages.npsAvg ?? 0)}</div></div>
        </div>
        <table class="x-table">${rows.map((r,i)=>`<tr>${r.map(c=> i? `<td>${esc(c)}</td>`:`<th>${esc(c)}</th>`).join('')}</tr>`).join('')}</table>
      `;
      openModal({ title:'교육 성과 전반 요약 상세', contentHTML:content });
    });

    // 갤러리
    mount.querySelector('[data-act="openGallery"]')?.addEventListener('click', ()=>{
      const content = `<div class="gal gal-lg">${(gallery||[]).map(url => `<div class="thumb"><img src="${url}" alt="asset"/></div>`).join('') || `<div class="muted">자산이 없습니다.</div>`}</div>`;
      openModal({ title:'포함 디자인 갤러리', contentHTML:content });
    });
  }

  // 처음 그리기
  paint();

  // 파괴 시 리스너 정리(선택)
  mount.addEventListener('DOMNodeRemoved', ()=>{
    window.removeEventListener('hrd:preview-year', onPreview);
    window.removeEventListener('hrd:preview-clear', onPreviewClear);
    window.removeEventListener('hrd:year-updated', window[NS]);
  });
}

/* ===== 내부 유틸 ===== */
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

function ensureStyle(){
  if (document.getElementById('wg-style')) return;
  const s = document.createElement('style'); s.id='wg-style';
  s.textContent = `.sec-hd h3{margin:0 0 8px;color:#d6e6ff;font-weight:800}`;
  document.head.appendChild(s);
}

const esc = (s)=> String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
