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
  let data = await loadYears(db, programId, years);

  const blocks = [];
  if (enabled.includes('content')) blocks.push(block('교육 내용','content'));
  if (enabled.includes('budget'))  blocks.push(block('교육 예산','budget'));
  if (enabled.includes('outcome')) blocks.push(block('교육 성과','outcome'));
  if (enabled.includes('design'))  blocks.push(block('교육 디자인','design'));

  mount.innerHTML = `<div class="sec">${blocks.join('<div class="divider"></div>')}</div>`;

  if (enabled.includes('content')) initCarousel('content', renderContentCard);
  if (enabled.includes('budget'))  initCarousel('budget',  renderBudgetCard);
  if (enabled.includes('outcome')) initCarousel('outcome', renderOutcomeCard);
  if (enabled.includes('design'))  initCarousel('design',  renderDesignCard);

  // 외부 저장이 끝나면(모달 저장 포함) 카드들을 즉시 갱신
  const onUpdated = async (e)=>{
    if(!e?.detail || e.detail.programId !== programId) return;
    data = await loadYears(db, programId, years);
    refreshAll();
  };
  window.addEventListener('hrd:data-updated', onUpdated);

  // 상세 모달을 검색/딥링크로 바로 열도록 지원
  const openOnSignal = async (e)=>{
    const d = e.detail || {};
    const kinds = { 'items:content':'content', 'items:budget':'budget', 'items:outcome':'outcome', 'items:design':'design' };
    const kind = kinds[d.section]; if(!kind) return;
    await openDetail(kind, d.year || years[years.length-1]);
  };
  window.addEventListener('hrd:open-detail', openOnSignal);

  function initCarousel(kind, renderer){
    const host = mount.querySelector(`[data-kind="${kind}"] .cards`);
    const yBox = mount.querySelector(`[data-kind="${kind}"] .years`);
    let index = 0;
    const clamp = v => Math.max(0, Math.min(years.length-3, v));
    function slice(){ const s = years.slice(index,index+3); return s.length?s:years.slice(Math.max(0,years.length-3)); }
    function paint(){
      const s = slice(); yBox.textContent = s.join('  |  ');
      host.innerHTML = s.map(y=>`<article class="it-card" data-year="${y}"></article>`).join('');
      host.querySelectorAll('.it-card').forEach(el=>{
        const y = el.dataset.year; el.innerHTML = renderer(y, data[y] || {});
        el.querySelector('.see-detail')?.addEventListener('click', ()=> openDetail(kind, y));
      });
    }
    mount.querySelector(`[data-kind="${kind}"] .nav.prev`).addEventListener('click', ()=>{ index = clamp(index-1); paint(); });
    mount.querySelector(`[data-kind="${kind}"] .nav.next`).addEventListener('click', ()=>{ index = clamp(index+1); paint(); });
    paint();

    // 각 캐러셀을 새로 그릴 수 있도록 등록
    carousels[kind] = paint;
  }

  // 캐러셀 repaint registry
  const carousels = {};
  function refreshAll(){
    Object.values(carousels).forEach(fn=>fn && fn());
  }

  /* ---- 상세/수정 모달 ---- */
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
        ov.remove();
        // 즉시 반영
        window.dispatchEvent(new CustomEvent('hrd:data-updated',{ detail:{ programId, year:y, section:'items:content' }}));
      });
      return;
    }

    if (kind==='budget'){
      const items = (v?.budget?.items||[]).map(it=>({
        id: it.id || crypto.randomUUID(),
        name: it.name||'',
        unitCost: Number(it.unitCost||0),
        qty: Number(it.qty||0),
        subtotal: Number(it.subtotal||((+it.unitCost||0)*(+it.qty||0))),
        note: it.note||'',
        vendor: it.vendor||{ name:'', email:'', phone:'', site:'', address:'' }
      }));

      const html = `
        <div class="tbl-wrap">
          <div class="row" style="margin-bottom:8px; gap:8px; align-items:center">
            ${EDIT?`<input type="file" id="csvFile" accept=".csv" />
            <button class="om-btn" id="importCsv">파일 가져오기</button>`:''}
            <span class="muted small">${EDIT?`CSV(쉼표 구분) 업로드를 지원합니다.`:''}</span>
          </div>
          <table class="x-table" id="bdTbl">
            <thead>
              <tr>
                <th>항목</th><th>단가</th><th>수량</th><th>소계</th><th>비고</th><th>업체</th>${EDIT?'<th></th>':''}
              </tr>
            </thead>
            <tbody></tbody>
            <tfoot>
              <tr>
                <th colspan="3" style="text-align:right">합계</th>
                <th id="bdTotal">0</th>
                <th colspan="${EDIT?2:1}"></th>
              </tr>
            </tfoot>
          </table>
        </div>
        ${EDIT?'<div style="margin-top:8px"><button class="om-btn" id="addRow">행 추가</button> <button class="om-btn primary" id="save">저장</button></div>':''}
      `;
      const ov = openModal({ title:`${y} 예산 상세`, contentHTML: html });
      const tbody = ov.querySelector('#bdTbl tbody');
      const totalEl = ov.querySelector('#bdTotal');

      // --- 행 DOM 생성 (재그리기 없음, 부분 갱신) ---
      function mountRows(){
        tbody.innerHTML = '';
        items.forEach((it,i)=>{
          const tr = document.createElement('tr'); tr.dataset.i = i;
          tr.innerHTML = `
            <td>${EDIT?`<input class="cell name" value="${esc(it.name)}">`:`${esc(it.name)}`}</td>
            <td>${EDIT?`<input class="cell unit" type="number" step="1" min="0" value="${it.unitCost}">`:`${fmt.format(it.unitCost)}`}</td>
            <td>${EDIT?`<input class="cell qty" type="number" step="1" min="0" value="${it.qty}">`:`${it.qty}`}</td>
            <td class="subtotal">${fmt.format((+it.unitCost||0)*(+it.qty||0))}</td>
            <td>${EDIT?`<input class="cell note" value="${esc(it.note)}">`:`${esc(it.note)}`}</td>
            <td>${vendorChip(it.vendor)}</td>
            ${EDIT?`<td><button class="om-btn delRow">삭제</button></td>`:''}
          `;
          tbody.appendChild(tr);
        });

        // 이벤트: 입력 → 부분 갱신(한 글자만 들어가던 문제 해결)
        if(EDIT){
          tbody.querySelectorAll('input.cell').forEach(inp=>{
            inp.addEventListener('input', ()=>{
              const row = inp.closest('tr'); const i = +row.dataset.i;
              const cls = inp.classList.contains('name')?'name':
                          inp.classList.contains('unit')?'unitCost':
                          inp.classList.contains('qty')?'qty':
                          'note';
              const val = (cls==='unitCost'||cls==='qty') ? Number(inp.value||0) : inp.value;
              items[i][cls] = val;
              const sub = (+items[i].unitCost||0) * (+items[i].qty||0);
              items[i].subtotal = sub;
              row.querySelector('.subtotal').textContent = fmt.format(sub);
              paintTotal();
            }, { passive:true });
          });
          // 삭제
          tbody.querySelectorAll('.delRow').forEach(btn=>{
            btn.addEventListener('click', ()=>{
              const i = +btn.closest('tr').dataset.i;
              items.splice(i,1);
              mountRows(); paintTotal();
            });
          });
        }

        // 벤더 툴팁
        tbody.querySelectorAll('.v-chip').forEach(chip=>{
          chip.addEventListener('mouseenter', ()=>{
            const box = chip.querySelector('.v-tip'); if(box) box.style.opacity = '1';
          });
          chip.addEventListener('mouseleave', ()=>{
            const box = chip.querySelector('.v-tip'); if(box) box.style.opacity = '0';
          });
        });
      }

      const paintTotal = ()=>{
        const total = items.reduce((s,it)=> s + ((+it.unitCost||0)*(+it.qty||0)), 0);
        totalEl.textContent = fmt.format(total);
      };

      mountRows(); paintTotal();

      // CSV 임포트(옵션)
      ov.querySelector('#importCsv')?.addEventListener('click', async ()=>{
        const f = ov.querySelector('#csvFile')?.files?.[0];
        if(!f) return alert('CSV 파일을 선택하세요.');
        const text = await f.text();
        // 간단 파서: header 포함 가정
        const lines = text.split(/\r?\n/).filter(Boolean);
        if(!lines.length) return;
        const header = lines.shift().split(',').map(h=>h.trim().toLowerCase());
        const idx = (keyCandidates)=> {
          for(const k of keyCandidates){ const i = header.indexOf(k); if(i>-1) return i; }
          return -1;
        };
        const cName = idx(['item','항목','name']);
        const cUnit = idx(['unitcost','단가']);
        const cQty  = idx(['qty','수량']);
        const cNote = idx(['note','비고']);
        const cV    = idx(['vendor','업체']);
        const cE    = idx(['email','이메일']);
        const cP    = idx(['phone','연락처','전화']);
        const cS    = idx(['site','url','사이트']);
        const cA    = idx(['address','주소']);

        const parsed = lines.map(line=>{
          // 따옴표 최소 처리
          const cells = line.split(',').map(s=>s.replace(/^"(.*)"$/,'$1'));
          return {
            id: crypto.randomUUID(),
            name: cells[cName] || '',
            unitCost: Number(cells[cUnit]||0),
            qty: Number(cells[cQty]||0),
            subtotal: Number(cells[cUnit]||0) * Number(cells[cQty]||0),
            note: cells[cNote] || '',
            vendor: {
              name: cells[cV]||'',
              email: cells[cE]||'',
              phone: cells[cP]||'',
              site: cells[cS]||'',
              address: cells[cA]||'',
            }
          };
        });
        items.splice(0, items.length, ...parsed);
        mountRows(); paintTotal();
      });

      // 행 추가 / 저장
      ov.querySelector('#addRow')?.addEventListener('click', ()=>{
        items.push({ id:crypto.randomUUID(), name:'', unitCost:0, qty:0, subtotal:0, note:'', vendor:{name:'',email:'',phone:'',site:'',address:''} });
        mountRows(); paintTotal();
      });
      ov.querySelector('#save')?.addEventListener('click', async ()=>{
        const cleaned = items.map(it=>({ ...it, subtotal:(+it.unitCost||0)*(+it.qty||0) }));
        await setDoc(yRef, { budget:{ items: cleaned }, updatedAt: Date.now() }, { merge:true });
        ov.remove();
        // 즉시 반영(카드/위젯)
        window.dispatchEvent(new CustomEvent('hrd:data-updated',{ detail:{ programId, year:y, section:'items:budget' }}));
      });
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
        ov.remove();
        window.dispatchEvent(new CustomEvent('hrd:data-updated',{ detail:{ programId, year:y, section:'items:outcome' }}));
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

      function repaint(){
        ov.querySelector('#galBox').innerHTML = assets.length? assets.map(u=>thumb(u,true)).join('') : '<div class="muted">자산 없음</div>';
        if (EDIT){
          ov.querySelectorAll('.delAsset').forEach(btn=>{
            btn.addEventListener('click', async ()=>{
              const url = btn.dataset.url;
              try{ await deleteObject(ref(storage, url)); }catch(e){}
              await updateDoc(yRef, { 'design.assetLinks': arrayRemove(url) });
              const idx = assets.indexOf(url); if (idx>-1) assets.splice(idx,1);
              repaint();
              window.dispatchEvent(new CustomEvent('hrd:data-updated',{ detail:{ programId, year:y, section:'items:design' }}));
            });
          });
        }
      }
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
        repaint(); alert('업로드 완료');
        window.dispatchEvent(new CustomEvent('hrd:data-updated',{ detail:{ programId, year:y, section:'items:design' }}));
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
  const total = (v?.budget?.items||[]).reduce((s,it)=>s+(Number(it.unitCost||0)*Number(it.qty||0)),0);
  return `
    <div class="cap">${y}</div>
    <div class="mini-table">
      ${items.length
        ? items.map(it=>`<div class="row"><div>${esc(it.name||'항목')}</div><div>${fmt.format(Number(it.unitCost||0)*Number(it.qty||0))} 원</div></div>`).join('')
        : '<div class="muted">항목 없음</div>'}
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

function ensureStyle(){
  if (document.getElementById('it-style')) return;
  const s = document.createElement('style'); s.id='it-style';
  s.textContent = `
  .v-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--line);border-radius:999px;background:#0e1a2c;cursor:default;position:relative;}
  .v-chip .dot{width:6px;height:6px;border-radius:50%;background:#79a8ff}
  .v-chip .v-tip{position:absolute;left:0;top:calc(100% + 8px);width:220px;background:#0f1929;border:1px solid var(--line);border-radius:12px;padding:10px;box-shadow:var(--shadow-sm);opacity:0;pointer-events:none;transition:opacity .12s}
  .v-tip b{display:block;margin-bottom:4px}
  .sec-hd h3{margin:0 0 8px;color:#d6e6ff;font-weight:800}`;
  document.head.appendChild(s);
}
const esc = (s)=> String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function thumb(url, deletable){ return `<div class="thumb"><img src="${url}">${deletable?`<div style="margin-top:6px;text-align:center"><button class="om-btn delAsset" data-url="${url}">삭제</button></div>`:''}</div>`; }
function vendorChip(v){
  const name = esc(v?.name||'');
  const email = esc(v?.email||'');
  const phone = esc(v?.phone||'');
  const site  = esc(v?.site||'');
  const addr  = esc(v?.address||'');
  const tip = `
    <div class="v-tip">
      <b>${name||'-'}</b>
      ${email?`${email}<br>`:''}
      ${phone?`${phone}<br>`:''}
      ${site?`${site}<br>`:''}
      ${addr?`${addr}`:''}
    </div>`;
  return `<span class="v-chip"><span class="dot"></span>${name||'업체'}${tip}</span>`;
}
