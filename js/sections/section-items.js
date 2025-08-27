// js/sections/section-items.js
import { doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { loadYears, fmt } from "../utils/helpers.js";
import { openModal } from "../utils/modal.js";

let EDIT = false;
export function updateItemEditMode(on){ EDIT = !!on; }

/**
 * schema.sections.items = ['content','budget','outcome','design'] 중 일부
 */
export async function renderItemSection({ db, storage, programId, mount, years, schema }) {
  ensureStyle();
  const enabled = (schema?.sections?.items || ['content','budget','outcome','design']);

  // 최초 데이터 로드
  let data = await loadYears(db, programId, years);

  // 렌더러 맵 (부분 갱신 시 사용)
  const RENDERERS = {
    content: renderContentCard,
    budget:  renderBudgetCard,
    outcome: renderOutcomeCard,
    design:  renderDesignCard,
  };

  // 블록 템플릿
  const blocks = [];
  if (enabled.includes('content')) blocks.push(block('교육 내용','content'));
  if (enabled.includes('budget'))  blocks.push(block('교육 예산','budget'));
  if (enabled.includes('outcome')) blocks.push(block('교육 성과','outcome'));
  if (enabled.includes('design'))  blocks.push(block('교육 디자인','design'));

  mount.innerHTML = `<div class="sec">${blocks.join('<div class="divider"></div>')}</div>`;

  // 각 섹션 캐러셀 초기화
  if (enabled.includes('content')) initCarousel('content', RENDERERS.content);
  if (enabled.includes('budget'))  initCarousel('budget',  RENDERERS.budget);
  if (enabled.includes('outcome')) initCarousel('outcome', RENDERERS.outcome);
  if (enabled.includes('design'))  initCarousel('design',  RENDERERS.design);

  function initCarousel(kind, renderer){
    const host = mount.querySelector(`[data-kind="${kind}"] .cards`);
    const yBox = mount.querySelector(`[data-kind="${kind}"] .years`);
    let index = 0;
    const clamp = v => Math.max(0, Math.min(years.length-3, v));
    const slice = ()=> {
      const s = years.slice(index,index+3);
      return s.length ? s : years.slice(Math.max(0,years.length-3));
    };
    const paint = ()=>{
      const s = slice();
      yBox.textContent = s.join('  |  ');
      host.innerHTML = s.map(y=>`<article class="it-card" data-year="${y}"></article>`).join('');
      host.querySelectorAll('.it-card').forEach(el=>{
        const y = el.dataset.year;
        el.innerHTML = renderer(y, data[y] || {});
        el.querySelector('.see-detail')?.addEventListener('click', ()=> openDetail(kind, y));
      });
    };
    mount.querySelector(`[data-kind="${kind}"] .nav.prev`).addEventListener('click', ()=>{ index = clamp(index-1); paint(); });
    mount.querySelector(`[data-kind="${kind}"] .nav.next`).addEventListener('click', ()=>{ index = clamp(index+1); paint(); });
    paint();
  }

  /* ---------- 저장 후 새로고침 없이 카드/합계 즉시 반영(부분 갱신) ---------- */
  const onYearUpdated = async (e)=>{
    const { programId: pid } = e.detail || {};
    if (pid !== programId) return;
    data = await loadYears(db, programId, years);

    ['content','budget','outcome','design'].forEach(kind=>{
      if (!enabled.includes(kind)) return;
      const yBox = mount.querySelector(`[data-kind="${kind}"] .years`);
      const host = mount.querySelector(`[data-kind="${kind}"] .cards`);
      if (!yBox || !host) return;

      const shownYears = yBox.textContent.split('|').map(s=>s.trim()).filter(Boolean);
      shownYears.forEach(y=>{
        const card = host.querySelector(`.it-card[data-year="${y}"]`);
        if (!card) return;
        card.innerHTML = RENDERERS[kind](y, data[y] || {});
        card.querySelector('.see-detail')?.addEventListener('click', ()=> openDetail(kind, y));
      });
    });
  };
  const NS = `hrd-year-updated-items-${programId}`;
  window.removeEventListener('hrd:year-updated', window[NS]);
  window[NS] = onYearUpdated;
  window.addEventListener('hrd:year-updated', onYearUpdated);

  /* ---------- 딥링크 상세 열기 ---------- */
  const mapSectionId = (sec)=>{
    const m = {
      'items:content':'content',
      'items:budget':'budget',
      'items:outcome':'outcome',
      'items:design':'design',
    };
    return m[sec] || sec;
  };
  const NS2 = `hrd-open-detail-items-${programId}`;
  window.removeEventListener('hrd:open-detail', window[NS2]);
  window[NS2] = (e)=>{
    const { section, year } = e.detail || {};
    const kind = mapSectionId(section);
    if (!['content','budget','outcome','design'].includes(kind)) return;
    const y = year || (years && years[0]);
    if (y) openDetail(kind, y);
  };
  window.addEventListener('hrd:open-detail', window[NS2]);

  /* ---- 상세/수정 모달 ---- */
  async function openDetail(kind, y){
    const yRef = doc(db,'programs',programId,'years',y);
    const snap = await getDoc(yRef);
    const v = snap.exists()? snap.data(): {};

    if (kind==='content'){
      // 노션스러운 경량 RTE + 툴바
      const isEdit = EDIT;
      const safeHtml = v?.content?.outlineHtml || esc(v?.content?.outline||'');
      const html = `
        <div class="rte-toolbar ${isEdit?'':'hidden'}">
          <button class="rtb" data-cmd="bold" title="굵게"><b>B</b></button>
          <button class="rtb" data-cmd="italic" title="기울임"><i>I</i></button>
          <span class="sep"></span>
          <button class="rtb" data-block="H1" title="제목 1">H1</button>
          <button class="rtb" data-block="H2" title="제목 2">H2</button>
          <span class="sep"></span>
          <button class="rtb" data-cmd="insertUnorderedList" title="글머리 목록">• List</button>
          <button class="rtb" data-cmd="insertOrderedList" title="번호 목록">1. List</button>
          <button class="rtb" data-block="QUOTE" title="콜아웃">❝</button>
          <span class="sep"></span>
          <button class="rtb" data-cmd="strikeThrough" title="취소선">S̶</button>
          <button class="rtb" data-cmd="createLink" title="링크">🔗</button>
        </div>
        ${isEdit
          ? `<div id="cHtml" class="rte" contenteditable="true">${safeHtml}</div>
             <div style="margin-top:10px"><button class="om-btn primary" id="save">저장</button></div>`
          : `<div class="rte-view">${safeHtml || '(내용 없음)'}</div>`
        }
      `;
      const ov = openModal({ title:`${y} 교육 내용 상세`, contentHTML: html });

      if (isEdit){
        initToolbar(ov);
        ov.querySelector('#save')?.addEventListener('click', async ()=>{
          const valHtml = ov.querySelector('#cHtml').innerHTML.trim();
          await setDoc(yRef, { content:{ outlineHtml:valHtml }, updatedAt: Date.now() }, { merge:true });
          window.dispatchEvent(new CustomEvent('hrd:year-updated', { detail:{ programId, year:y } }));
          alert('저장되었습니다.');
          ov.remove();
        });
      }
      return;
    }

    if (kind==='budget'){
      const coerce = (it)=>({
        name: it?.name||'',
        unitCost: Number(it?.unitCost||0),
        qty: Number(it?.qty||0),
        subtotal: Number(it?.subtotal||0),
        note: it?.note||'',
        vendor: {
          name: it?.vendor?.name||'',
          email: it?.vendor?.email||'',
          phone: it?.vendor?.phone||'',
          site:  it?.vendor?.site||'',
          addr:  it?.vendor?.addr||'',
        }
      });
      const items = (v?.budget?.items||[]).map(coerce);

      const html = `
        <div class="importer ${EDIT?'':'hidden'}">
          <div class="row wrap" style="gap:8px">
            <input type="file" id="bdFile" accept=".csv,.xlsx,.xls">
            <button class="om-btn" id="bdImport">파일 가져오기</button>
            <span class="muted small">템플릿:
              <button class="linklike" id="tplCsv" type="button">CSV</button> ·
              <button class="linklike" id="tplXlsx" type="button">XLSX</button>
            </span>
          </div>
        </div>

        <div class="tbl-wrap">
          <table class="x-table" id="bdTbl">
            <thead>
              <tr>
                <th>항목</th><th>단가</th><th>수량</th><th>소계</th><th>비고</th>
                <th>업체</th>${EDIT?'<th></th>':''}
              </tr>
            </thead>
            <tbody></tbody>
            <tfoot><tr><th colspan="3" style="text-align:right">합계</th><th id="bdTotal">0</th><th colspan="${EDIT?2:1}"></th></tr></tfoot>
          </table>
        </div>
        ${EDIT?'<div style="margin-top:8px"><button class="om-btn" id="addRow">행 추가</button> <button class="om-btn primary" id="save">저장</button></div>':''}
      `;
      const ov = openModal({ title:`${y} 예산 상세`, contentHTML: html });
      const tbody = ov.querySelector('#bdTbl tbody'); const totalEl = ov.querySelector('#bdTotal');

      const vendorChip = (v)=> v?.name
        ? `<span class="v-chip" data-vendor='${encodeURIComponent(JSON.stringify(v))}'>${esc(v.name)}</span>`
        : `<span class="muted small">-</span>`;

      const recomputeTotal = ()=>{
        const total = items.reduce((s,it)=> s+(Number(it.subtotal)||0),0);
        totalEl.textContent = fmt.format(total);
      };

      const rowHTML=(it,i)=>`
        <tr data-i="${i}">
          <td>${EDIT?`<input data-i="${i}" data-k="name" value="${esc(it.name)}">`:`${esc(it.name)}`}</td>
          <td>${EDIT?`<input type="text" inputmode="numeric" pattern="[0-9]*" class="num" data-i="${i}" data-k="unitCost" value="${it.unitCost}">`:`${fmt.format(it.unitCost)}`}</td>
          <td>${EDIT?`<input type="text" inputmode="numeric" pattern="[0-9]*" class="num" data-i="${i}" data-k="qty" value="${it.qty}">`:`${it.qty}`}</td>
          <td data-role="subtotal">${fmt.format((Number(it.unitCost)||0)*(Number(it.qty)||0))}</td>
          <td>${EDIT?`<input data-i="${i}" data-k="note" value="${esc(it.note)}">`:`${esc(it.note)}`}</td>
          <td>${vendorChip(it.vendor)} ${EDIT?`<button class="om-btn vEdit" data-i="${i}">업체</button>`:''}</td>
          ${EDIT?`<td><button class="om-btn delRow" data-i="${i}">삭제</button></td>`:''}
        </tr>`;

      const paint=()=>{
        tbody.innerHTML = items.map((it,i)=> rowHTML(it,i)).join('');
        if (EDIT){
          // 이름/비고는 즉시 반영
          tbody.querySelectorAll('input[data-i][data-k="name"], input[data-i][data-k="note"]').forEach(inp=>{
            inp.addEventListener('input', ()=>{ const i=+inp.dataset.i, k=inp.dataset.k; items[i][k] = inp.value; });
          });

          // 숫자 입력은 재페인트 없이 갱신
          const sanitize = (s)=> String(s||'').replace(/[^\d.]/g,'');
          const updateRow = (i)=>{
            const row = tbody.querySelector(`tr[data-i="${i}"]`);
            if (!row) return;
            const subTd = row.querySelector('[data-role="subtotal"]');
            const it = items[i];
            it.subtotal = (Number(it.unitCost)||0) * (Number(it.qty)||0);
            if (subTd) subTd.textContent = fmt.format(it.subtotal);
            recomputeTotal();
          };
          tbody.querySelectorAll('input.num[data-i]').forEach(inp=>{
            inp.addEventListener('input', ()=>{
              const i = +inp.dataset.i, k = inp.dataset.k;
              const v = sanitize(inp.value);
              inp.value = v;
              items[i][k] = Number(v||0);
              updateRow(i);
            });
          });

          tbody.querySelectorAll('.delRow')?.forEach(btn=>{
            btn.addEventListener('click', ()=>{ const i=+btn.dataset.i; items.splice(i,1); paint(); });
          });
          tbody.querySelectorAll('.vEdit')?.forEach(btn=>{
            btn.addEventListener('click', ()=> openVendorEditor(+btn.dataset.i));
          });
        }
        recomputeTotal();

        // 툴팁
        tbody.querySelectorAll('.v-chip').forEach(ch=>{
          const data = JSON.parse(decodeURIComponent(ch.dataset.vendor||'%7B%7D'));
          attachVendorTip(ch, data);
        });
      };

      paint();

      ov.querySelector('#addRow')?.addEventListener('click', ()=>{ items.push({name:'',unitCost:0,qty:0,subtotal:0,note:'',vendor:{}}); paint(); });
      ov.querySelector('#save')?.addEventListener('click', async ()=>{
        const cleaned = items.map(it=>({
          ...it,
          subtotal:(Number(it.unitCost)||0)*(Number(it.qty)||0),
          vendor: it.vendor || {}
        }));
        await setDoc(yRef, { budget:{ items: cleaned }, updatedAt: Date.now() }, { merge:true });
        window.dispatchEvent(new CustomEvent('hrd:year-updated', { detail:{ programId, year:y } }));
        alert('저장되었습니다.');
        ov.remove();
      });

      ov.querySelector('#bdImport')?.addEventListener('click', async ()=>{
        const f = ov.querySelector('#bdFile')?.files?.[0];
        if(!f){ alert('CSV 또는 XLSX 파일을 선택하세요.'); return; }
        try{
          const rows = await parseBudgetFile(f);
          if(!rows.length){ alert('가져올 데이터가 없습니다.'); return; }
          const replace = confirm('기존 행을 모두 대체할까요? (취소 = 뒤에 추가)');
          if(replace) items.splice(0, items.length);
          rows.forEach(r=>{
            items.push({
              name:r.name||'',
              unitCost:Number(r.unitCost||0),
              qty:Number(r.qty||0),
              subtotal:(Number(r.unitCost)||0)*(Number(r.qty)||0),
              note:r.note||'',
              vendor:{
                name:r.vendor?.name||r.vendor||'',
                email:r.vendor?.email||r.email||'',
                phone:r.vendor?.phone||r.phone||'',
                site:r.vendor?.site||r.url||r.site||'',
                addr:r.vendor?.addr||r.address||'',
              }
            });
          });
          paint();
          window.dispatchEvent(new CustomEvent('hrd:year-updated', { detail:{ programId, year:y } }));
          alert('가져오기 완료');
        }catch(e){
          console.error(e); alert('가져오는 중 오류가 발생했습니다.');
        }
      });

      ov.querySelector('#tplCsv')?.addEventListener('click', ()=> downloadBudgetTemplate('csv'));
      ov.querySelector('#tplXlsx')?.addEventListener('click', ()=> downloadBudgetTemplate('xlsx'));

      function openVendorEditor(i){
        const cur = items[i].vendor || {};
        const html = `
          <div class="mini-form">
            <label>업체명<input id="vName" value="${esc(cur.name||'')}"></label>
            <label>Email<input id="vEmail" value="${esc(cur.email||'')}"></label>
            <label>전화<input id="vPhone" value="${esc(cur.phone||'')}"></label>
            <label>웹사이트<input id="vSite" value="${esc(cur.site||'')}"></label>
            <label>주소<input id="vAddr" value="${esc(cur.addr||'')}"></label>
          </div>
        `;
        const mv = openModal({
          title:'업체 정보',
          contentHTML:html,
          footerHTML:`<button class="om-btn" id="close">취소</button><button class="om-btn primary" id="ok">적용</button>`
        });
        mv.querySelector('#close').addEventListener('click', ()=> mv.remove());
        mv.querySelector('#ok').addEventListener('click', ()=>{
          items[i].vendor = {
            name: mv.querySelector('#vName').value.trim(),
            email: mv.querySelector('#vEmail').value.trim(),
            phone: mv.querySelector('#vPhone').value.trim(),
            site:  mv.querySelector('#vSite').value.trim(),
            addr:  mv.querySelector('#vAddr').value.trim(),
          };
          mv.remove();
          paint();
          window.dispatchEvent(new CustomEvent('hrd:year-updated', { detail:{ programId, year:y } }));
        });
      }

      return;
    }

    if (kind==='outcome'){
      const s = v?.outcome?.surveySummary || {};
      const kpis     = (v?.outcome?.kpis||[]).map(x=>({ name:x.name||'', value:x.value||'', target:x.target||'', status:x.status||'' }));
      const insights = (v?.outcome?.insights||[]).map(x=>({ title:x.title||'', detail:x.detail||'' }));

      const html = `
        <div class="mini-table">
          <div class="row"><div>응답수</div><div>${EDIT?`<input id="oN" type="number" value="${s.n||0}">`:(s.n||0)}</div></div>
          <div class="row"><div>CSAT</div><div>${EDIT?`<input id="oC" type="number" step="0.1" value="${s.csat??''}">`:(s.csat??'-')}</div></div>
          <div class="row"><div>NPS</div><div>${EDIT?`<input id="oP" type="number" value="${s.nps??''}">`:(s.nps??'-')}</div></div>
        </div>

        <h4 style="margin:10px 0 6px">KPI</h4>
        <div id="kpiBox"></div>
        ${EDIT?'<button class="om-btn" id="kpiAdd">KPI 추가</button>':''}

        <h4 style="margin:12px 0 6px">인사이트</h4>
        <div id="insBox"></div>
        ${EDIT?'<button class="om-btn" id="insAdd">인사이트 추가</button>':''}

        ${EDIT?'<div style="margin-top:10px"><button class="om-btn primary" id="save">저장</button></div>':''}
      `;
      const ov = openModal({ title:`${y} 성과 상세`, contentHTML: html });

      const paintKV = ()=>{
        const kpiBox = ov.querySelector('#kpiBox');
        kpiBox.innerHTML = kpis.map((k,i)=>`
          <div class="kv" style="display:grid; grid-template-columns:1.2fr 1fr 1fr .8fr auto; gap:8px; margin-bottom:6px">
            ${EDIT?`<input class="inp" data-i="${i}" data-k="name"  value="${esc(k.name)}" placeholder="지표">`:`<b>${esc(k.name)}</b>`}
            ${EDIT?`<input class="inp" data-i="${i}" data-k="value" value="${esc(k.value)}" placeholder="값">`:`<span>${esc(k.value)}</span>`}
            ${EDIT?`<input class="inp" data-i="${i}" data-k="target" value="${esc(k.target)}" placeholder="목표">`:`<span>${esc(k.target)}</span>`}
            ${EDIT?`<input class="inp" data-i="${i}" data-k="status" value="${esc(k.status)}" placeholder="상태">`:`<span>${esc(k.status)}</span>`}
            ${EDIT?`<button class="om-btn delK" data-i="${i}">삭제</button>`:''}
          </div>
        `).join('') || '<div class="muted">없음</div>';

        const insBox = ov.querySelector('#insBox');
        insBox.innerHTML = insights.map((k,i)=>`
          <div class="kv" style="display:grid; grid-template-columns:1fr 2fr auto; gap:8px; margin-bottom:6px">
            ${EDIT?`<input class="inp" data-i="${i}" data-k="title" value="${esc(k.title)}" placeholder="제목">`:`<b>${esc(k.title)}</b>`}
            ${EDIT?`<input class="inp" data-i="${i}" data-k="detail" value="${esc(k.detail)}" placeholder="내용">`:`<span>${esc(k.detail)}</span>`}
            ${EDIT?`<button class="om-btn delI" data-i="${i}">삭제</button>`:''}
          </div>
        `).join('') || '<div class="muted">없음</div>';

        if (EDIT){
          ov.querySelectorAll('#kpiBox .inp').forEach(inp=>{
            inp.addEventListener('input', ()=>{ const i=+inp.dataset.i; const k=inp.dataset.k; kpis[i][k]=inp.value; });
          });
          ov.querySelectorAll('#insBox .inp').forEach(inp=>{
            inp.addEventListener('input', ()=>{ const i=+inp.dataset.i; const k=inp.dataset.k; insights[i][k]=inp.value; });
          });
          ov.querySelectorAll('.delK').forEach(b=> b.addEventListener('click', ()=>{ kpis.splice(+b.dataset.i,1); paintKV(); }));
          ov.querySelectorAll('.delI').forEach(b=> b.addEventListener('click', ()=>{ insights.splice(+b.dataset.i,1); paintKV(); }));
        }
      };
      paintKV();

      ov.querySelector('#kpiAdd')?.addEventListener('click', ()=>{ kpis.push({name:'',value:'',target:'',status:''}); paintKV(); });
      ov.querySelector('#insAdd')?.addEventListener('click', ()=>{ insights.push({title:'',detail:''}); paintKV(); });
      ov.querySelector('#save')?.addEventListener('click', async ()=>{
        const payload = {
          outcome:{
            surveySummary:{
              n: Number(ov.querySelector('#oN')?.value||s.n||0),
              csat: Number(ov.querySelector('#oC')?.value||s.csat||0),
              nps: Number(ov.querySelector('#oP')?.value||s.nps||0)
            },
            kpis, insights
          },
          updatedAt: Date.now()
        };
        await setDoc(yRef, payload, { merge:true });
        window.dispatchEvent(new CustomEvent('hrd:year-updated', { detail:{ programId, year:y } }));
        alert('저장되었습니다.');
        ov.remove();
      });
      return;
    }

    if (kind==='design'){
      // ------- (디자인 탭: 이미지 강제 다운로드 + 텍스트 우선 정렬) -------
      const legacy = (v?.design?.assetLinks||[]).map(u=>({ id: crypto.randomUUID(), type:'img', url:u, memo:'' }));
      const originAssets = Array.isArray(v?.design?.assets) ? v.design.assets.slice() : legacy;
      let assets = originAssets.map(a=>({ ...a }));
      const pendingDeleteUrls = new Set();

      const ov = openModal({
        title:`${y} 디자인 상세`,
        contentHTML: `
          <div class="gal-actions">
            ${EDIT?`
              <div class="row wrap" style="gap:8px">
                <input type="file" id="dFiles" multiple accept="image/*">
                <button class="om-btn primary" id="dUpload">이미지 업로드</button>
                <button class="om-btn" id="dAddText">텍스트 추가</button>
              </div>
            `:''}
          </div>
          <div id="galGrid" class="gal-grid"></div>
        `,
        footerHTML: EDIT
          ? `<button class="om-btn" id="dCancel">취소</button><button class="om-btn primary" id="dSave">저장</button>`
          : ``
      });

      const gal = ov.querySelector('#galGrid');

      const persistAssets = async ()=>{
        const links = assets.filter(a=>a.type==='img').map(a=>a.url);
        await updateDoc(doc(db,'programs',programId,'years',y), {
          'design.assets': assets,
          'design.assetLinks': links,
          updatedAt: Date.now()
        });
        for (const url of pendingDeleteUrls){
          try{ await deleteObject(ref(storage, url)); }catch(_){}
        }
        pendingDeleteUrls.clear();
        window.dispatchEvent(new CustomEvent('hrd:year-updated', { detail:{ programId, year:y } }));
      };

      const card = (a,i)=>{
        if (a.type==='text'){
          return `
            <div class="gcard" data-i="${i}">
              <div class="gtext">
                <div class="gtext-main">
                  ${a.href?`<a href="${esc(a.href)}" target="_blank" rel="noopener">${esc(a.text||'텍스트')}</a>`:esc(a.text||'텍스트')}
                </div>
              </div>
              ${a.memo?`<div class="gmemo">${esc(a.memo)}</div>`:''}
              ${EDIT?`
                <div class="gedit">
                  <input class="ginp gtxt" placeholder="텍스트" value="${esc(a.text||'')}">
                  <input class="ginp ghref" placeholder="URL(선택)" value="${esc(a.href||'')}">
                  <input class="ginp gm" placeholder="메모(선택)" value="${esc(a.memo||'')}">
                  <button class="om-btn danger gdel">삭제</button>
                </div>
              `:''}
            </div>`;
        }
        return `
          <div class="gcard" data-i="${i}">
            <figure class="gimg">
              <button class="dl-btn" data-url="${a.url}" title="다운로드" aria-label="다운로드">
                <img src="${a.url}" alt="asset">
              </button>
            </figure>
            ${a.memo?`<div class="gmemo">${esc(a.memo)}</div>`:''}
            ${EDIT?`
              <div class="gedit">
                <input class="ginp gm" placeholder="메모(예: 9월 전표)" value="${esc(a.memo||'')}">
                <button class="om-btn danger gdel">삭제</button>
              </div>
            `:''}
          </div>`;
      };

      const paint = ()=>{
        const view = assets.slice().sort(a=> a.type==='text' ? -1 : 1);
        gal.innerHTML = view.length
          ? view.map(card).join('')
          : `<div class="muted">자산 없음</div>`;

        // 다운로드 핸들러(상세)
        gal.querySelectorAll('.dl-btn').forEach(btn=>{
          btn.addEventListener('click', async ()=>{
            const url = btn.dataset.url;
            await forceDownload(url, `${programId}-${y}.jpg`);
          });
        });

        if (!EDIT) return;

        gal.querySelectorAll('.gcard').forEach(box=>{
          const i = +box.dataset.i;
          box.querySelector('.gm')?.addEventListener('input', (e)=>{ assets[i].memo = e.target.value; });
          box.querySelector('.gtxt')?.addEventListener('input', (e)=>{ assets[i].text = e.target.value; });
          box.querySelector('.ghref')?.addEventListener('input', (e)=>{ assets[i].href = e.target.value; });
          box.querySelector('.gdel')?.addEventListener('click', ()=>{
            const a = assets[i];
            if (a.type==='img' && a.url) pendingDeleteUrls.add(a.url);
            assets.splice(i,1);
            paint();
          });
        });
      };

      ov.querySelector('#dUpload')?.addEventListener('click', async ()=>{
        const files = Array.from(ov.querySelector('#dFiles')?.files||[]);
        if (!files.length) return;
        for (const file of files){
          const r = ref(storage, `programs/${programId}/years/${y}/design/${Date.now()}_${file.name}`);
          await uploadBytes(r, file);
          const url = await getDownloadURL(r);
          assets.push({ id: crypto.randomUUID(), type:'img', url, memo:'' });
        }
        paint();
        alert('업로드 완료 (저장을 눌러야 반영됩니다)');
      });

      ov.querySelector('#dAddText')?.addEventListener('click', ()=>{
        const mv = openModal({
          title:'텍스트 자산 추가',
          contentHTML: `
            <div class="mini-form">
              <label>텍스트<input id="tText" placeholder="예: 9월 전표"></label>
              <label>링크(URL, 선택)<input id="tHref" placeholder="https://..."></label>
              <label>메모(선택)<input id="tMemo" placeholder="설명"></label>
            </div>
          `,
          footerHTML:`<button class="om-btn" id="cancel">취소</button><button class="om-btn primary" id="ok">추가</button>`
        });
        mv.querySelector('#cancel').addEventListener('click', ()=> mv.remove());
        mv.querySelector('#ok').addEventListener('click', ()=>{
          const text = mv.querySelector('#tText').value.trim();
          const href = mv.querySelector('#tHref').value.trim();
          const memo = mv.querySelector('#tMemo').value.trim();
          if (!text){ alert('텍스트를 입력하세요.'); return; }
          assets.push({ id: crypto.randomUUID(), type:'text', text, href, memo });
          mv.remove();
          paint();
        });
      });

      ov.querySelector('#dSave')?.addEventListener('click', async ()=>{
        if (!confirm('디자인 변경 내용을 저장할까요?')) return;
        await persistAssets();
        alert('저장되었습니다.');
        ov.remove();
      });
      ov.querySelector('#dCancel')?.addEventListener('click', ()=>{
        if (!confirm('변경 내용을 취소하고 닫을까요? 저장되지 않습니다.')) return;
        pendingDeleteUrls.clear();
        ov.remove();
      });

      paint();
      return;
    }
  }
}

/* ===== 블록/카드 렌더 ===== */
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
  // 불릿 제거 + 엔티티 정규화 → 3줄 미리보기 (카드 터짐 방지)
  const html = v?.content?.outlineHtml || '';
  const plain = html ? stripTags(html) : (v?.content?.outline||'');
  const normalized = plain.replace(/&nbsp;/g, ' ');
  const lines = normalized.split('\n').map(s=>s.trim()).filter(Boolean);
  const snippet = lines.slice(0,3).join(' ');
  return `
    <div class="cap">${y}</div>
    <div class="txt-snippet">${esc(snippet || '내용 미입력')}</div>
    <div class="ft"><button class="btn small see-detail">상세 보기</button></div>
  `;
}

/* ▶ 미리보기: 예산은 '합계만' 크게 노출 */
function renderBudgetCard(y, v){
  const total = (v?.budget?.items||[]).reduce((s,it)=>s+(Number(it.subtotal)||0),0);
  const count = (v?.budget?.items||[]).length;
  return `
    <div class="cap">${y}</div>
    <div class="kpi-total">
      <div class="t">합계</div>
      <div class="v">${fmt.format(total)}<span class="unit"> 원</span></div>
      <div class="sub">${count}개 항목</div>
    </div>
    <div class="ft"><button class="btn small see-detail">상세 보기</button></div>
  `;
}

/* ▶ 미리보기: 성과는 요약 바 + KPI 칩(최대 3개) */
function renderOutcomeCard(y, v){
  const s = v?.outcome?.surveySummary || {};
  const kpis = (v?.outcome?.kpis || []).slice(0,3);
  const csat = (s.csat ?? '-');
  const nps  = (s.nps  ?? '-');
  const n    = (s.n || 0);
  const pills = kpis.length
    ? `<div class="kpi-pills">${kpis.map(k=>`<span class="pill" title="${esc(k.target?`목표 ${k.target}`:'')}">${esc(k.name||'KPI')} : ${esc(k.value||'-')}</span>`).join('')}</div>`
    : `<div class="muted small">등록된 KPI 없음</div>`;
  return `
    <div class="cap">${y}</div>
    <div class="outcome-summary">
      <span class="m">응답수 <b>${n}</b></span>
      <span class="d">|</span>
      <span class="m">CSAT <b>${csat}</b></span>
      <span class="d">|</span>
      <span class="m">NPS <b>${nps}</b></span>
    </div>
    ${pills}
    <div class="ft"><button class="btn small see-detail">상세 보기</button></div>
  `;
}

function renderDesignCard(y, v){
  const norm = Array.isArray(v?.design?.assets)
    ? v.design.assets
    : (v?.design?.assetLinks||[]).map(u=>({ type:'img', url:u, memo:'' }));
  // 텍스트 먼저, 그리고 이미지(미리보기 3개)
  const view = norm.slice().sort(a=> a.type==='text' ? -1 : 1).slice(0,3);
  const cells = view.map(a=>{
    if (a.type==='text'){
      return `<div class="thumb text"><div class="tx">${esc(a.text||'텍스트')}${a.href?` <span class="link-hint">↗</span>`:''}</div>${a.memo?`<div class="mini-memo">${esc(a.memo)}</div>`:''}</div>`;
    }
    return `<div class="thumb">
      <button class="dl-btn" data-url="${a.url}" title="다운로드"><img src="${a.url}" alt=""><div class="mini-memo">${esc(a.memo||'')}</div></button>
    </div>`;
  }).join('');
  const html = `
    <div class="cap">${y}</div>
    <div class="gal">${cells || '<div class="muted">자산 없음</div>'}</div>
    <div class="ft"><button class="btn small see-detail">상세 보기</button></div>
  `;
  return html;
}

/* ===== 파일 파서 & 템플릿 ===== */
function headerMap(h){
  const key = String(h||'').trim().toLowerCase().replace(/\ufeff/g,'');
  if (/(항목|품목|item|name)/.test(key)) return 'name';
  if (/(단가|금액|unit.?cost|price)/.test(key)) return 'unitCost';
  if (/(수량|qty|quantity)/.test(key)) return 'qty';
  if (/(비고|메모|note|remark)/.test(key)) return 'note';
  if (/(업체|공급처|vendor|company)/.test(key)) return 'vendor';
  if (/(email|메일)/.test(key)) return 'email';
  if (/(phone|tel|전화)/.test(key)) return 'phone';
  if (/(site|url|website|웹사이트)/.test(key)) return 'url';
  if (/(address|addr|주소)/.test(key)) return 'address';
  return null;
}

async function parseBudgetFile(file){
  const ext = (file.name.split('.').pop()||'').toLowerCase();
  if (ext === 'csv'){
    const text = await file.text();
    return parseCSV(text);
  }
  if (ext === 'xlsx' || ext === 'xls'){
    let XLSX = (globalThis.XLSX)||null;
    if(!XLSX){
      try{
        XLSX = (await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.mjs')).default;
      }catch(e){
        console.warn('XLSX 모듈 로드 실패, CSV만 지원됩니다.'); throw new Error('XLSX 모듈 로드 실패');
      }
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type:'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const arr = XLSX.utils.sheet_to_json(ws, { header:1 });
    return rowsFromAOA(arr);
  }
  throw new Error('지원하지 않는 형식');
}

function parseCSV(text){
  const src = String(text||'').replace(/^\ufeff/,'').replace(/\r\n/g,'\n');
  const lines = src.split('\n').filter(l => l.length>0);
  const rows = lines.map(line=>{
    const cells = [];
    let cur = '', inQ=false;
    for (let i=0;i<line.length;i++){
      const ch = line[i];
      if (ch === '"' ){
        if (inQ && line[i+1]==='"'){ cur+='"'; i++; }
        else { inQ=!inQ; }
      } else if (ch === ',' && !inQ){
        cells.push(cur); cur='';
      } else {
        cur+=ch;
      }
    }
    cells.push(cur);
    return cells.map(s=>s.trim());
  });
  return rowsFromAOA(rows);
}

function rowsFromAOA(rows){
  if(!rows.length) return [];
  const head = rows[0].map(headerMap);
  return rows.slice(1).filter(r=>r.some(c=>String(c||'').trim().length)).map(r=>{
    const obj = {};
    head.forEach((k,idx)=>{
      if(!k) return;
      obj[k] = r[idx];
    });
    const vendor = (obj.vendor||obj.company) ? { name:obj.vendor||obj.company } : {};
    if (obj.email) vendor.email = obj.email;
    if (obj.phone) vendor.phone = obj.phone;
    if (obj.url)   vendor.site  = obj.url;
    if (obj.address) vendor.addr = obj.address;
    return {
      name: obj.name||'',
      unitCost: Number(obj.unitCost||0),
      qty: Number(obj.qty||0),
      note: obj.note||'',
      vendor
    };
  });
}

function csvEscapeField(s){
  const needs = /[",\n]/.test(s);
  if (!needs) return s;
  return `"${s.replace(/"/g,'""')}"`;
}

function downloadBudgetTemplate(kind='csv'){
  const headers = ['항목','단가','수량','비고','업체','email','phone','site','address'];
  const sample = [
    ['장소 대관','500000','1','1일 기준','A 컨벤션','sales@a.co','02-000-0000','https://a.co','서울시 ○○구 ○○로 12'],
    ['강사료','800000','1','부가세 포함','홍길동','','','',''],
    ['디자인','300000','1','배너/안내물','디자인랩','hello@design.com','','https://design.com',''],
  ];

  if (kind==='csv'){
    const bom = '\uFEFF';
    const lines = [];
    lines.push(headers.map(csvEscapeField).join(','));
    sample.forEach(r=> lines.push(r.map(v=>csvEscapeField(String(v))).join(',')));
    const csv = bom + lines.join('\r\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='budget-template.csv'; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    return;
  }

  (async ()=>{
    let XLSX = (globalThis.XLSX)||null;
    if(!XLSX){
      try{ XLSX = (await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.mjs')).default; }
      catch(e){ alert('XLSX 모듈을 불러올 수 없어 CSV 템플릿만 제공합니다.'); return; }
    }
    const wb = XLSX.utils.book_new();
    const wsData = [headers, ...sample];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const colWidths = headers.map((h,idx)=>{
      const maxLen = wsData.reduce((m,row)=> Math.max(m, String(row[idx]??'').length), h.length);
      return { wch: Math.min(30, Math.max(10, Math.ceil(maxLen*1.2))) };
    });
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, 'Budget');
    XLSX.writeFile(wb, 'budget-template.xlsx');
  })();
}

/* ===== 공용: 강제 다운로드 ===== */
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
    // 폴백: download 속성 시도 후 새탭
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.target='_blank'; a.rel='noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
}

/* ===== 업체 툴팁 ===== */
function attachVendorTip(anchor, vendor){
  let tip;
  const show = ()=>{
    if (tip) return;
    const lines = [
      vendor.name && `<div class="v-row"><b>${esc(vendor.name)}</b></div>`,
      vendor.email && `<div class="v-row">${esc(vendor.email)}</div>`,
      vendor.phone && `<div class="v-row">${esc(vendor.phone)}</div>`,
      vendor.site  && `<div class="v-row"><a href="${vendor.site}" target="_blank">${esc(vendor.site)}</a></div>`,
      vendor.addr  && `<div class="v-row">${esc(vendor.addr)}</div>`,
    ].filter(Boolean).join('');
    if(!lines) return;
    tip = document.createElement('div');
    tip.className = 'vendor-tip';
    tip.innerHTML = lines;
    document.body.appendChild(tip);
    const r = anchor.getBoundingClientRect();
    const x = r.left + (r.width/2);
    const y = r.bottom + 8;
    tip.style.left = Math.max(12, x - tip.offsetWidth/2) + 'px';
    tip.style.top  = y + 'px';
  };
  const hide = ()=>{ if(tip){ tip.remove(); tip=null; } };
  anchor.addEventListener('mouseenter', show);
  anchor.addEventListener('mouseleave', hide);
}

/* ===== RTE 툴바 유틸 ===== */
function initToolbar(root){
  const ed = root.querySelector('#cHtml');
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

/* ===== 유틸/스타일 ===== */
function ensureStyle(){
  if (document.getElementById('it-style')) return;
  const s = document.createElement('style'); s.id='it-style';
  s.textContent = `
  .sec-hd h3{margin:0 0 8px;color:#d6e6ff;font-weight:800}

  /* 카드 그리드 & 고정 높이(터짐 방지) */
  .it-sec .cards{ display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
  .it-card{
    background:#0f1b22; border:1px solid var(--line); border-radius:12px; padding:12px;
    min-height:190px; max-height:190px; display:flex; flex-direction:column; gap:10px; overflow:hidden;
  }
  .it-card .cap{ font-weight:700; color:#eaf2ff; flex:0 0 auto; }
  .it-card .ft{ flex:0 0 auto; margin-top:auto; }

  /* 본문 영역은 미리보기 전용(넘침 방지) */
  .it-card > .mini-table,
  .it-card > .bul,
  .it-card > .txt-snippet,
  .it-card > .gal,
  .it-card > .kpi-total,
  .it-card > .outcome-summary,
  .it-card > .kpi-pills{
    flex:1 1 auto; min-height:0; overflow:hidden;
  }

  /* Budget 합계만 프리뷰 */
  .kpi-total{display:flex; flex-direction:column; gap:4px; align-items:flex-start; justify-content:center}
  .kpi-total .t{font-size:.92rem; color:#aac8ff}
  .kpi-total .v{font-size:1.4rem; font-weight:800; color:#eaf2ff; line-height:1.2}
  .kpi-total .v .unit{font-size:.9rem; font-weight:600; opacity:.8; margin-left:2px}
  .kpi-total .sub{font-size:.86rem; color:#cfe2ff; opacity:.9}

  /* outcome 카드 미리보기 요약바 + KPI 칩 */
  .outcome-summary{
    display:flex; align-items:center; gap:8px; padding:6px 8px; border:1px dashed #223246;
    border-radius:8px; color:#cfe2ff; white-space:nowrap; overflow:hidden;
  }
  .outcome-summary .m{opacity:.95}
  .outcome-summary .m b{color:#eaf2ff}
  .outcome-summary .d{opacity:.5}
  .kpi-pills{display:flex; flex-wrap:wrap; gap:6px; margin-top:6px}
  .kpi-pills .pill{
    max-width:100%; display:inline-block; padding:4px 8px; border-radius:999px;
    background:#132235; border:1px solid var(--line); color:#d6e6ff; font-size:.82rem;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }

  /* 콘텐츠 카드 텍스트 미리보기 */
  .txt-snippet{
    white-space:normal; word-break:break-word; overflow:hidden;
    display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; line-height:1.4;
  }

  .importer .linklike{background:none;border:0;color:#8fb7ff;cursor:pointer;text-decoration:underline}
  .v-chip{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border:1px solid var(--line);border-radius:999px;background:#132235;color:#dbebff;font-size:.86rem}
  .mini-badge{display:inline-block;margin-left:6px;padding:2px 6px;border-radius:999px;background:#132235;border:1px solid var(--line);font-size:.8rem;color:#cfe2ff}
  .vendor-tip{position:fixed;z-index:9999;max-width:280px;background:#0f1b2b;border:1px solid #2a3a45;border-radius:10px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.35);color:#eaf2ff}
  .vendor-tip .v-row{line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  /* RTE */
  .rte-toolbar{display:flex; gap:6px; align-items:center; margin-bottom:8px}
  .rte-toolbar .rtb{padding:6px 8px; border:1px solid var(--line); background:#0c1522; color:#eaf2ff; border-radius:8px; cursor:pointer}
  .rte-toolbar .sep{width:8px; height:1px; background:#2a3a45; display:inline-block}
  .rte, .rte-view{min-height:240px; padding:12px; border:1px solid var(--line); background:#0f1b22; border-radius:8px; max-height:62vh; overflow:auto}
  .rte:focus{outline:2px solid #3e68ff}

  /* 디자인 갤러리(상세) */
  .gal-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
  .gcard{ background:#0f1b22; border:1px solid var(--line); border-radius:12px; overflow:hidden; display:flex; flex-direction:column; gap:0; }
  .gimg{width:100%; aspect-ratio: 4/3; overflow:hidden; background:#0b141e; border-bottom:1px solid var(--line);}
  .gimg img{width:100%; height:100%; object-fit:contain; display:block;}
  .gimg .dl-btn{display:block; width:100%; height:100%; border:0; padding:0; background:none; cursor:pointer}
  .gtext{padding:14px 12px;}
  .gtext-main{font-weight:700; color:#eaf2ff; word-break:break-word;}
  .gmemo{padding:8px 12px; border-top:1px dashed #223246; color:#cfe2ff; font-size:.9rem;}
  .gedit{display:flex; gap:6px; padding:8px; border-top:1px solid var(--line); background:#0c1522}
  .ginp{flex:1; min-width:0}
  .gal-actions{margin-bottom:10px}

  /* 카드(요약) 갤러리 스타일 보정 : 포함 디자인 5열 */
  .gal{display:grid; grid-template-columns:repeat(5, 90px); gap:8px; align-items:start}
  .gal .thumb{width:90px; height:70px; border-radius:8px; overflow:hidden; background:#0b141e; border:1px solid var(--line); position:relative}
  .gal .thumb img{width:100%; height:100%; object-fit:cover; display:block}
  .gal .thumb .mini-memo{position:absolute; left:0; right:0; bottom:0; background:rgba(0,0,0,.45); color:#fff; font-size:.72rem; padding:2px 6px}
  .gal .thumb.text{display:flex; align-items:center; justify-content:center; padding:6px; color:#eaf2ff; font-size:.82rem; text-align:center}
  .gal .thumb button{display:block; width:100%; height:100%; border:0; padding:0; background:none; cursor:pointer}
  .link-hint{opacity:.8}
  .mini-memo{color:#cfe2ff}
  `;
  document.head.appendChild(s);

  // 위젯 미리보기 썸네일 버튼(다운로드) 위임 바인딩
  document.addEventListener('click', async (e)=>{
    const btn = e.target?.closest?.('.gal .thumb button.dl-btn');
    if (!btn) return;
    const url = btn.dataset.url;
    await forceDownload(url, 'design-asset.jpg');
  });
}
const esc = (s)=> String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function stripTags(html){ return String(html||'').replace(/<\/?[^>]+(>|$)/g, ''); }
