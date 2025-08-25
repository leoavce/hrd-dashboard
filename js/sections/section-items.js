// js/sections/section-items.js
import { doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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

  /* ---------- 저장 후 새로고침 없이 카드/합계 즉시 반영을 위한 부분 갱신 ---------- */
  const onYearUpdated = async (e)=>{
    const { programId: pid, year: yUpd } = e.detail || {};
    if (pid !== programId) return;

    // 최신 데이터 재로드
    data = await loadYears(db, programId, years);

    // 현재 보여지는 연도들만 각 섹션의 카드 내용을 리바인딩
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
        // “상세 보기” 버튼 재바인딩
        card.querySelector('.see-detail')?.addEventListener('click', ()=> openDetail(kind, y));
      });
    });
  };
  // 중복리스너 방지용 네임스페이스 키
  const NS = `hrd-year-updated-items-${programId}`;
  // 기존 리스너 제거 후 재등록(라우팅 재진입 대비)
  window.removeEventListener('hrd:year-updated', window[NS]);
  window[NS] = onYearUpdated;
  window.addEventListener('hrd:year-updated', onYearUpdated);

  /* ---- 상세/수정 모달 (업로드/업체 툴팁 포함) ---- */
  async function openDetail(kind, y){
    const yRef = doc(db,'programs',programId,'years',y);
    const snap = await getDoc(yRef);
    const v = snap.exists()? snap.data(): {};

    if (kind==='content'){
      const html = `<textarea id="cOutline" style="width:100%;min-height:320px" ${EDIT?'':'readonly'}>${esc(v?.content?.outline||'')}</textarea>`;
      const ov = openModal({ title:`${y} 교육 내용 상세`, contentHTML: html, footerHTML: EDIT? `<button class="om-btn primary" id="save">저장</button>`:'' });
      ov.querySelector('#save')?.addEventListener('click', async ()=>{
        const val = ov.querySelector('#cOutline').value;
        await setDoc(yRef, { content:{ outline:val }, updatedAt: Date.now() }, { merge:true });
        // 저장 즉시 부분 갱신 트리거
        window.dispatchEvent(new CustomEvent('hrd:year-updated', { detail:{ programId, year:y } }));
        alert('저장되었습니다.');
        ov.remove();
      });
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
          <div class="muted small" style="margin-top:6px">
            열 헤더(한/영 혼용 가능): 항목(item) / 단가(unitCost) / 수량(qty) / 비고(note) /
            업체(vendor) / email / phone / site(url) / address(주소)
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

      const paint=()=>{
        tbody.innerHTML = items.map((it,i)=> rowHTML(it,i)).join('');
        if (EDIT){
          tbody.querySelectorAll('input[data-i]').forEach(inp=>{
            const handler = ()=>{
              const i = +inp.dataset.i, k = inp.dataset.k;
              if (k==='name' || k==='note'){ items[i][k] = inp.value; }
              else { items[i][k] = Number(inp.value||0); }
              items[i].subtotal = (Number(items[i].unitCost)||0) * (Number(items[i].qty)||0);
              const pos = inp.selectionStart;
              paint();
              const again = tbody.querySelector(`input[data-i="${i}"][data-k="${k}"]`);
              if (again){ again.focus(); try{ again.setSelectionRange(pos,pos); }catch(_){} }
            };
            inp.addEventListener('input', handler);
          });
          tbody.querySelectorAll('.delRow')?.forEach(btn=>{
            btn.addEventListener('click', ()=>{ const i=+btn.dataset.i; items.splice(i,1); paint(); });
          });
          tbody.querySelectorAll('.vEdit')?.forEach(btn=>{
            btn.addEventListener('click', ()=> openVendorEditor(+btn.dataset.i));
          });
        }
        const total = items.reduce((s,it)=> s+(Number(it.subtotal)||0),0);
        totalEl.textContent = fmt.format(total);
        tbody.querySelectorAll('.v-chip').forEach(ch=>{
          const data = JSON.parse(decodeURIComponent(ch.dataset.vendor||'%7B%7D'));
          attachVendorTip(ch, data);
        });
      };

      const rowHTML=(it,i)=>`
        <tr>
          <td>${EDIT?`<input data-i="${i}" data-k="name" value="${esc(it.name)}">`:`${esc(it.name)}`}</td>
          <td>${EDIT?`<input type="number" data-i="${i}" data-k="unitCost" value="${it.unitCost}">`:`${fmt.format(it.unitCost)}`}</td>
          <td>${EDIT?`<input type="number" data-i="${i}" data-k="qty" value="${it.qty}">`:`${it.qty}`}</td>
          <td>${fmt.format((Number(it.unitCost)||0)*(Number(it.qty)||0))}</td>
          <td>${EDIT?`<input data-i="${i}" data-k="note" value="${esc(it.note)}">`:`${esc(it.note)}`}</td>
          <td>${vendorChip(it.vendor)} ${EDIT?`<button class="om-btn vEdit" data-i="${i}">업체</button>`:''}</td>
          ${EDIT?`<td><button class="om-btn delRow" data-i="${i}">삭제</button></td>`:''}
        </tr>`;

      paint();

      // 행 추가/저장
      ov.querySelector('#addRow')?.addEventListener('click', ()=>{ items.push({name:'',unitCost:0,qty:0,subtotal:0,note:'',vendor:{}}); paint(); });
      ov.querySelector('#save')?.addEventListener('click', async ()=>{
        const cleaned = items.map(it=>({
          ...it,
          subtotal:(Number(it.unitCost)||0)*(Number(it.qty)||0),
          vendor: it.vendor || {}
        }));
        await setDoc(yRef, { budget:{ items: cleaned }, updatedAt: Date.now() }, { merge:true });
        // 저장 즉시 부분 갱신 트리거
        window.dispatchEvent(new CustomEvent('hrd:year-updated', { detail:{ programId, year:y } }));
        alert('저장되었습니다.');
        ov.remove();
      });

      // 파일 가져오기 / 템플릿 다운로드
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
          // 업로드만 해도 카드 즉시 반영
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
          footerHTML:`<button class="om-btn" id="close">닫기</button><button class="om-btn primary" id="ok">적용</button>`
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
          // 업체만 바꿔도 카드 즉시 반영
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
        // 저장 즉시 부분 갱신
        window.dispatchEvent(new CustomEvent('hrd:year-updated', { detail:{ programId, year:y } }));
        alert('저장되었습니다.');
        ov.remove();
      });
      return;
    }

    if (kind==='design'){
      const assets = (v?.design?.assetLinks||[]).slice();
      const html = `
        <div class="gal gal-lg" id="galBox">${assets.map(url=>thumb(url,true)).join('') || '<div class="muted">자산 없음</div>'}</div>
        ${EDIT?`
        <div class="row" style="margin-top:10px">
          <input type="file" id="f" multiple>
          <button class="om-btn primary" id="up">업로드</button>
        </div>`:''}
      `;
      const ov = openModal({ title:`${y} 디자인 상세`, contentHTML: html });

      const repaint=()=>{
        ov.querySelector('#galBox').innerHTML = assets.length? assets.map(u=>thumb(u,true)).join('') : '<div class="muted">자산 없음</div>';
        if (EDIT){
          ov.querySelectorAll('.delAsset').forEach(btn=>{
            btn.addEventListener('click', async ()=>{
              const url = btn.dataset.url;
              try{ await deleteObject(ref(storage, url)); }catch(e){}
              await updateDoc(yRef, { 'design.assetLinks': arrayRemove(url) });
              const idx = assets.indexOf(url); if (idx>-1) assets.splice(idx,1);
              repaint();
              // 삭제 즉시 부분 갱신
              window.dispatchEvent(new CustomEvent('hrd:year-updated', { detail:{ programId, year:y } }));
            });
          });
        }
      };
      ov.querySelector('#up')?.addEventListener('click', async ()=>{
        const files = Array.from(ov.querySelector('#f').files||[]);
        if (!files.length) return;
        for (const file of files){
          const r = ref(storage, `programs/${programId}/years/${y}/design/${Date.now()}_${file.name}`);
          await uploadBytes(r, file);
          const url = await getDownloadURL(r);
          await updateDoc(yRef, { 'design.assetLinks': arrayUnion(url) });
          assets.push(url);
        }
        repaint();
        // 업로드 즉시 부분 갱신
        window.dispatchEvent(new CustomEvent('hrd:year-updated', { detail:{ programId, year:y } }));
        alert('업로드 완료');
      });
      repaint();
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
  const ol = (v?.content?.outline||'').split('\n').slice(0,3).map(s=>`<li>${esc(s)}</li>`).join('');
  return `
    <div class="cap">${y}</div>
    <ul class="bul">${ol || '<li>내용 미입력</li>'}</ul>
    <div class="ft"><button class="btn small see-detail">상세 보기</button></div>
  `;
}
function renderBudgetCard(y, v){
  const items=(v?.budget?.items||[]).slice(0,3);
  const total = (v?.budget?.items||[]).reduce((s,it)=>s+(Number(it.subtotal)||0),0);
  const vendorBadge = (ven)=> ven?.name ? `<span class="mini-badge" title="${[ven.email,ven.site].filter(Boolean).join(' | ')}">${esc(ven.name)}</span>` : '';
  return `
    <div class="cap">${y}</div>
    <div class="mini-table">
      ${items.map(it=>`<div class="row"><div>${esc(it.name||'항목')} ${vendorBadge(it.vendor)}</div><div>${fmt.format(Number(it.subtotal||0))} 원</div></div>`).join('') || '<div class="muted">항목 없음</div>'}
      <div class="row"><div><strong>합계</strong></div><div><strong>${fmt.format(total)} 원</strong></div></div>
    </div>
    <div class="ft"><button class="btn small see-detail">상세 보기</button></div>
  `;
}
function renderOutcomeCard(y, v){
  const s=v?.outcome?.surveySummary||{};
  const kpis=(v?.outcome?.kpis||[]).slice(0,2);
  return `
    <div class="cap">${y}</div>
    <div class="mini-table">
      <div class="row"><div>응답수</div><div>${s.n||0}</div></div>
      <div class="row"><div>CSAT</div><div>${s.csat??'-'}</div></div>
      <div class="row"><div>NPS</div><div>${s.nps??'-'}</div></div>
    </div>
    <ul class="bul" style="margin-top:6px">${kpis.map(k=>`<li>${esc(k.name||'')}: ${esc(k.value||'')}</li>`).join('')}</ul>
    <div class="ft"><button class="btn small see-detail">상세 보기</button></div>
  `;
}
function renderDesignCard(y, v){
  const assets=(v?.design?.assetLinks||[]).slice(0,3);
  return `
    <div class="cap">${y}</div>
    <div class="gal">${assets.map(u=>`<div class="thumb"><img src="${u}"></div>`).join('') || '<div class="muted">자산 없음</div>'}</div>
    <div class="ft"><button class="btn small see-detail">상세 보기</button></div>
  `;
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
        // ✅ 올바른 경로로 수정
        XLSX = (await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.mjs')).default;
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
      try{
        // ✅ 올바른 경로로 수정
        XLSX = (await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.mjs')).default;
      }
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

/* ===== 유틸/스타일 ===== */
function ensureStyle(){
  if (document.getElementById('it-style')) return;
  const s = document.createElement('style'); s.id='it-style';
  s.textContent = `
  .sec-hd h3{margin:0 0 8px;color:#d6e6ff;font-weight:800}
  .importer .linklike{background:none;border:0;color:#8fb7ff;cursor:pointer;text-decoration:underline}
  .v-chip{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border:1px solid var(--line);border-radius:999px;background:#132235;color:#dbebff;font-size:.86rem}
  .mini-badge{display:inline-block;margin-left:6px;padding:2px 6px;border-radius:999px;background:#132235;border:1px solid var(--line);font-size:.8rem;color:#cfe2ff}
  .vendor-tip{position:fixed;z-index:9999;max-width:280px;background:#0f1b2b;border:1px solid #2a3a45;border-radius:10px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.35);color:#eaf2ff}
  .vendor-tip .v-row{line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  `;
  document.head.appendChild(s);
}
const esc = (s)=> String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function thumb(url, deletable){ return `<div class="thumb"><img src="${url}">${deletable?`<div style="margin-top:6px;text-align:center"><button class="om-btn delAsset" data-url="${url}">삭제</button></div>`:''}</div>`; }
