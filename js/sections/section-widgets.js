// js/sections/section-widgets.js
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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

  /** 모든 연도의 디자인 asset을 모아 중복 제거(중복으로 2번 보이는 버그 방지) */
  function mergedAssetsFrom(ymap){
    const set = new Set();
    for (const y of years){
      const d = (ymap[y]?.design)||{};
      if (Array.isArray(d.assets)){
        d.assets.forEach(a=>{ if (a?.type==='img' && a.url) set.add(a.url); });
      }
      if (Array.isArray(d.assetLinks)){
        d.assetLinks.forEach(u=> set.add(u));
      }
    }
    // 레거시 single 문서도 보조로 포함
    if (Array.isArray(single?.design?.assetLinks)){
      single.design.assetLinks.forEach(u=> set.add(u));
    }
    return Array.from(set);
  }

  function paint(){
    const ymap = mergedYearMap();
    const budgetAverages  = calcBudgetAverage(ymap);
    const outcomeAverages = calcOutcomeAverage(ymap);

    const gallery = mergedAssetsFrom(ymap);
    const randomAssets = pickRandom(gallery, 6);

    const tiles = [];
    if (enabled.includes('summary')) tiles.push(tile('교육 내용 전반 요약', `
      <div class="note-preview">${(summary?.widgetNote || '교육 개요 요약을 입력하세요.').replace(/\n/g,'<br>')}</div>
    `,'openSummary'));

    if (enabled.includes('budget')) tiles.push(tile('예산안 평균', `
      <div class="mini-table">
        <div class="row"><div>평균 총액</div><div>${fmt.format(Math.round(budgetAverages.totalAvg || 0))} 원</div></div>
        ${(budgetAverages.items || []).slice(0,4).map(it=>`
          <div class="row"><div>${esc(it.name)}</div><div>${fmt.format(Math.round(it.avg||0))} 원</div></div>
        `).join('')}
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
        ${randomAssets.length
          ? randomAssets.map(url => `<div class="thumb"><a href="${url}" download><img src="${url}" alt="asset"/></a></div>`).join('')
          : `<div class="muted">디자인 자산이 없습니다.</div>`
        }
      </div>
    `,'openGallery'));

    mount.innerHTML = `<div class="sec sec-wg"><div class="grid4">${tiles.join('')}</div></div>`;

    // 상세 모달들
    bindModals(ymap, gallery, budgetAverages, outcomeAverages, years);
  }

  function bindModals(ymap, gallery, budgetAverages, outcomeAverages, years){
    // ===== 요약(노션풍 에디터) =====
    mount.querySelector('[data-act="openSummary"]')?.addEventListener('click', ()=>{
      const content = `
        <div class="editor-bar ${EDIT?'':'hidden'}">
          <button data-cmd="bold"><b>B</b></button>
          <button data-cmd="italic"><i>I</i></button>
          <button data-block="h2">H2</button>
          <button data-block="blockquote">❝</button>
          <button data-list="insertUnorderedList">•</button>
          <button data-list="insertOrderedList">1.</button>
          <button data-cmd="removeFormat">지우기</button>
        </div>
        <div id="wgTxt" class="rich-area" contenteditable="${EDIT?'true':'false'}">${summary?.widgetNote ? summary.widgetNote : ''}</div>
      `;
      const ov = openModal({
        title:'교육 내용 전반 요약',
        contentHTML:content,
        footerHTML: EDIT ? `<button class="om-btn primary" id="wgSave">저장</button>` : ''
      });

      // 툴바
      if (EDIT){
        ov.querySelectorAll('.editor-bar [data-cmd]').forEach(btn=>{
          btn.addEventListener('click', ()=> document.execCommand(btn.dataset.cmd,false,null));
        });
        ov.querySelectorAll('.editor-bar [data-block]').forEach(btn=>{
          btn.addEventListener('click', ()=> document.execCommand('formatBlock',false,btn.dataset.block));
        });
        ov.querySelectorAll('.editor-bar [data-list]').forEach(btn=>{
          btn.addEventListener('click', ()=> document.execCommand(btn.dataset.list,false,null));
        });
      }
      // 저장
      ov.querySelector('#wgSave')?.addEventListener('click', async ()=>{
        const html = ov.querySelector('#wgTxt').innerHTML;
        await setDoc(doc(db,'programs',programId,'meta','summary'), { widgetNote: html, updatedAt: Date.now() }, { merge:true });
        alert('저장되었습니다.'); ov.remove();
      });
    });

    // ===== 예산 평균 상세(동일 항목 평균 + 기타) =====
    mount.querySelector('[data-act="openBudget"]')?.addEventListener('click', ()=>{
      // 항목별 값 배열
      const itemsMap = {};
      years.forEach(y=>{
        (ymap[y]?.budget?.items || []).forEach(it=>{
          const name = (it?.name||'').trim();
          const val = Number(it?.subtotal||((+it.unitCost||0)*(+it.qty||0))||0);
          if (!name || !val) return;
          (itemsMap[name] ||= []).push(val);
        });
      });
      const rows = [];
      let etcSum=0, etcCnt=0;
      Object.keys(itemsMap).forEach(name=>{
        const arr = itemsMap[name];
        if (arr.length > 1){
          const avg = arr.reduce((s,v)=>s+v,0)/arr.length;
          rows.push([name, Math.round(avg)]);
        }else{
          etcSum += arr[0]; etcCnt += 1;
        }
      });
      if (etcCnt>0) rows.push(['기타', Math.round(etcSum/etcCnt)]);
      rows.sort((a,b)=> b[1]-a[1]);

      const content = `
        <div class="mini-table" style="margin-bottom:8px">
          <div class="row"><div><b>평균 총액</b></div><div><b>${fmt.format(Math.round(budgetAverages.totalAvg||0))} 원</b></div></div>
        </div>
        <table class="x-table">
          <tr><th>항목</th><th>평균 금액(원)</th></tr>
          ${rows.map(r=>`<tr><td>${esc(r[0])}</td><td>${fmt.format(r[1])}</td></tr>`).join('') || `<tr><td colspan="2">데이터 없음</td></tr>`}
        </table>
      `;
      openModal({ title:'예산안 평균 상세', contentHTML:content });
    });

    // ===== 성과 평균 상세 =====
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

    // ===== 갤러리(중복 제거 + 이미지 클릭 시 다운로드) =====
    mount.querySelector('[data-act="openGallery"]')?.addEventListener('click', ()=>{
      const list = Array.from(new Set(gallery||[]));
      const content = `<div class="gal gal-lg">
        ${list.length ? list.map(url => `<div class="thumb"><a href="${url}" download><img src="${url}" alt="asset"/></a></div>`).join('') : `<div class="muted">자산이 없습니다.</div>`}
      </div>`;
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
    const total = items.reduce((s,it)=> s + ((Number(it.subtotal)||((+it.unitCost||0)*(+it.qty||0)))||0), 0);
    if (total) totals.push(total);
    items.forEach(it=>{
      const k = (it.name||'항목').trim();
      const v = (Number(it.subtotal)||((+it.unitCost||0)*(+it.qty||0)))||0;
      if(!v) return;
      (itemsMap[k] ||= []).push(v);
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
  s.textContent = `
  .sec-hd h3{margin:0 0 8px;color:#d6e6ff;font-weight:800}
  .wg-card{display:flex;flex-direction:column;min-height:220px}
  .wg-bd{flex:1}
  .note-preview{white-space:pre-wrap; line-height:1.5}
  /* 간단 리치 에디터 */
  .editor-bar{display:flex;gap:6px;margin:0 0 8px}
  .editor-bar button{background:#0f1b22;border:1px solid var(--line);color:#eaf2ff;border-radius:8px;padding:4px 8px;cursor:pointer}
  .rich-area{min-height:260px;padding:12px;border:1px solid var(--line);border-radius:12px;background:#0b141e;color:#eaf2ff;line-height:1.55}
  .rich-area:focus{outline:2px solid #294a7a}
  /* 갤러리 */
  .gal{display:flex; gap:8px; flex-wrap:wrap}
  .gal .thumb{width:90px; height:70px; border-radius:8px; overflow:hidden; background:#0b141e; border:1px solid var(--line); position:relative}
  .gal .thumb img{width:100%; height:100%; object-fit:cover; display:block}
  .gal-lg{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  .gal-lg .thumb{width:100%;height:0;padding-top:66%;position:relative}
  .gal-lg .thumb img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}
  `;
  document.head.appendChild(s);
}

const esc = (s)=> String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
