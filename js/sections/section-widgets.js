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
    // 각 연도의 design.assets(type:'img') 및 레거시 assetLinks 수집 (중복 제거)
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
    // 단일문서(레거시)도 보조로 포함
    if (Array.isArray(single?.design?.assetLinks)){
      single.design.assetLinks.forEach(u=> set.add(u));
    }
    return [...set];
  }

  function paint(){
    const ymap = mergedYearMap();
    const budgetAverages  = calcBudgetAverage(ymap);
    const outcomeAverages = calcOutcomeAverage(ymap);

    const gallery = mergedAssetsFrom(ymap);
    const randomAssets = pickRandom(gallery, 6);

    const tiles = [];
    if (enabled.includes('summary')) tiles.push(tile('교육 내용 전반 요약', `
      <div class="wg-summary-preview">${(summary?.widgetNoteHtml || esc(summary?.widgetNote || '교육 개요 요약을 입력하세요.'))}</div>
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
        ${randomAssets.map(url => `
          <div class="thumb">
            <button class="dl-btn" data-url="${url}" title="다운로드">
              <img src="${url}" alt="asset"/>
            </button>
          </div>`).join('') || `<div class="muted">디자인 자산이 없습니다.</div>`}
      </div>
    `,'openGallery'));

    mount.innerHTML = `<div class="sec sec-wg"><div class="grid4">${tiles.join('')}</div></div>`;

    // 상세 모달들
    bindModals(ymap, gallery, budgetAverages, outcomeAverages, years);

    // 위젯 썸네일 다운로드(위임)
    mount.querySelectorAll('.dl-btn').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const url = btn.dataset.url;
        await forceDownload(url, 'design-asset.jpg');
      });
    });
  }

  function bindModals(ymap, gallery, budgetAverages, outcomeAverages, years){
    // 요약 (편집 저장 가능)
    mount.querySelector('[data-act="openSummary"]')?.addEventListener('click', async ()=>{
      // 최신 summary 문서 다시 로드(동시 편집 대비)
      const sSnap = await getDoc(doc(db,'programs',programId,'meta','summary'));
      const sVal  = sSnap.exists()? sSnap.data(): {};
      const isEdit = EDIT;
      const safeHtml = sVal?.widgetNoteHtml || esc(sVal?.widgetNote || '');

      const content = isEdit
        ? `
          <div class="rte-toolbar">
            <button class="rtb" data-cmd="bold"><b>B</b></button>
            <button class="rtb" data-cmd="italic"><i>I</i></button>
            <span class="sep"></span>
            <button class="rtb" data-block="H1">H1</button>
            <button class="rtb" data-block="H2">H2</button>
            <span class="sep"></span>
            <button class="rtb" data-cmd="insertUnorderedList">• List</button>
            <button class="rtb" data-cmd="insertOrderedList">1. List</button>
            <button class="rtb" data-block="QUOTE">❝</button>
            <span class="sep"></span>
            <button class="rtb" data-cmd="strikeThrough">S̶</button>
            <button class="rtb" data-cmd="createLink">🔗</button>
          </div>
          <div id="wgTxtHtml" class="rte" contenteditable="true">${safeHtml}</div>`
        : `<div class="rte-view">${safeHtml || '(내용 없음)'}</div>`;

      const ov = openModal({
        title:'교육 내용 전반 요약',
        contentHTML: content,
        footerHTML: isEdit ? `<button class="om-btn primary" id="wgSave">저장</button>` : ''
      });

      if (isEdit){
        initToolbar(ov, '#wgTxtHtml');
        ov.querySelector('#wgSave')?.addEventListener('click', async ()=>{
          const valHtml = ov.querySelector('#wgTxtHtml').innerHTML.trim();
          await setDoc(doc(db,'programs',programId,'meta','summary'), { widgetNoteHtml: valHtml, updatedAt: Date.now() }, { merge:true });
          alert('저장되었습니다.'); ov.remove();
          // UI 갱신
          const sSnap2 = await getDoc(doc(db,'programs',programId,'meta','summary'));
          summary = sSnap2.exists()? sSnap2.data(): {};
          paint();
        });
      }
    });

    // 예산 평균 상세(동일 항목 평균, 없다면 '기타')
    mount.querySelector('[data-act="openBudget"]')?.addEventListener('click', ()=>{
      const itemsAvg = (calcBudgetAverage(ymap).items||[]);
      const rows = [['항목','평균금액(원)']];

      if (!itemsAvg.length){
        rows.push(['기타','0']);
      }else{
        itemsAvg.forEach(it=> rows.push([it.name||'기타', fmt.format(Math.round(it.avg||0))]));
      }

      const content = `
        <div class="mini-table" style="margin-bottom:8px">
          <div class="row"><div><b>평균 총액</b></div><div><b>${fmt.format(Math.round(calcBudgetAverage(ymap).totalAvg||0))} 원</b></div></div>
        </div>
        <table class="x-table">${rows.map((r,i)=>`<tr>${r.map(c=> i? `<td>${esc(c)}</td>`:`<th>${esc(c)}</th>`).join('')}</tr>`).join('')}</table>
      `;
      openModal({ title:'예산안 평균(항목별)', contentHTML:content });
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

    // 갤러리(바둑판 + 다운로드)
    mount.querySelector('[data-act="openGallery"]')?.addEventListener('click', ()=>{
      const content = `<div class="gal gal-lg">
        ${(gallery||[]).map(url => `
          <div class="thumb">
            <button class="dl-btn" data-url="${url}" title="다운로드">
              <img src="${url}" alt="asset"/>
            </button>
          </div>`).join('') || `<div class="muted">자산이 없습니다.</div>`}
      </div>`;
      const ov = openModal({ title:'포함 디자인 갤러리', contentHTML:content });
      ov.querySelectorAll('.dl-btn').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const url = btn.dataset.url;
          await forceDownload(url, 'design-asset.jpg');
        });
      });
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
      const k = (it.name||'').trim() || '기타';
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
  s.textContent = `
  .sec-hd h3{margin:0 0 8px;color:#d6e6ff;font-weight:800}

  .sec-wg .grid4{ display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }
  .wg-card{ background:#0f1b22; border:1px solid var(--line); border-radius:12px; padding:12px;
            min-height:220px; max-height:220px; display:flex; flex-direction:column; overflow:hidden; }
  .wg-hd{ font-weight:800; color:#d6e6ff; margin-bottom:8px; flex:0 0 auto; }
  .wg-bd{ flex:1 1 auto; overflow:hidden }
  .wg-ft{ flex:0 0 auto; margin-top:8px }

  .mini-table .row{display:flex; justify-content:space-between; gap:12px}
  .wg-summary-preview{ max-height:150px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:6; -webkit-box-orient:vertical; word-break:break-word; }

  /* 위젯 갤러리(바둑판) */
  .gal{display:grid; grid-template-columns:repeat(3, 90px); gap:8px}
  .gal .thumb{width:90px; height:70px; border-radius:8px; overflow:hidden; background:#0b141e; border:1px solid var(--line); position:relative}
  .gal .thumb img{width:100%; height:100%; object-fit:cover; display:block}
  .gal .thumb button{display:block; width:100%; height:100%; border:0; padding:0; background:none; cursor:pointer}

  .gal.gal-lg{ grid-template-columns:repeat(4, 160px); }
  .gal.gal-lg .thumb{ width:160px; height:120px; }

  /* RTE */
  .rte-toolbar{display:flex; gap:6px; align-items:center; margin-bottom:8px}
  .rte-toolbar .rtb{padding:6px 8px; border:1px solid var(--line); background:#0c1522; color:#eaf2ff; border-radius:8px; cursor:pointer}
  .rte-toolbar .sep{width:8px; height:1px; background:#2a3a45; display:inline-block}
  .rte, .rte-view{min-height:200px; padding:12px; border:1px solid var(--line); background:#0f1b22; border-radius:8px; max-height:62vh; overflow:auto}
  .rte:focus{outline:2px solid #3e68ff}
  `;
  document.head.appendChild(s);
}

/* 공용: RTE 툴바 */
function initToolbar(root, selector){
  const ed = root.querySelector(selector);
  const exec = (cmd, val=null)=> document.execCommand(cmd,false,val);
  root.querySelectorAll('.rte-toolbar .rtb[data-cmd]').forEach(b=>{
    b.addEventListener('click', ()=>{
      if (b.dataset.cmd==='createLink'){
        const url = prompt('링크 URL'); if (url) exec('createLink', url);
      } else {
        exec(b.dataset.cmd);
      }
      ed?.focus();
    });
  });
  root.querySelectorAll('.rte-toolbar .rtb[data-block]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const t=b.dataset.block;
      if (t==='H1') exec('formatBlock','H1');
      else if (t==='H2') exec('formatBlock','H2');
      else if (t==='QUOTE') exec('formatBlock','BLOCKQUOTE');
      ed?.focus();
    });
  });
}

/* 공용: 강제 다운로드 */
async function forceDownload(url, filename='download'){
  try{
    const r = await fetch(url, { credentials:'omit' });
    if(!r.ok) throw new Error('fetch failed');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }catch(e){
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.target='_blank'; a.rel='noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
}

const esc = (s)=> String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
