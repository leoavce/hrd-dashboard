// js/app.js
import { auth, db, storage } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, deleteObject, listAll } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

import { getProgramSchema, DEFAULT_SCHEMA } from "./programSchema.js";
import { openSchemaEditor } from "./schemaUI.js";
import { initHomeDashboard } from "./ongoingDashboard.js";

import { renderWidgetSection, updateWidgetEditMode } from "./sections/section-widgets.js";
import { renderItemSection,   updateItemEditMode   } from "./sections/section-items.js";

/* ===== 공통 유틸(스니펫 안전 처리) ===== */
const nf = new Intl.NumberFormat("ko-KR");
const esc = (s)=> String(s ?? "").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));

/* ===== 인증 가드 ===== */
onAuthStateChanged(auth, (user)=>{
  if(!user){ location.replace('index.html'); return; }
  boot();
});

async function boot(){
  const userEmail = document.getElementById('userEmail');
  const logoutBtn = document.getElementById('logoutBtn');
  userEmail.textContent = auth.currentUser?.email || '';
  logoutBtn.addEventListener('click', async ()=>{
    try{ await signOut(auth); location.replace('index.html'); }catch(e){ console.error(e); }
  });

  window.addEventListener('hashchange', route);
  route();
}

/* ===== 라우팅 ===== */
const appEl = document.getElementById('app');
function parseQuery(qs){
  const out = {};
  (qs||'').replace(/^\?/,'').split('&').forEach(kv=>{
    if(!kv) return;
    const [k,v] = kv.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v||'');
  });
  return out;
}
function route(){
  const hash = location.hash || '#/home';
  const [_, page, rest] = hash.split('/');
  if(page === 'program' && rest){
    const [id, query] = rest.split('?');
    const params = parseQuery(query);
    renderProgramPage(id, {
      focus: params.focus, year: params.year,
      openDetail: params.detail === '1' // 모달 직접 오픈
    });
  }else{
    renderHome();
  }
}

/* ===== 시드 ===== */
const DEFAULT_PROGRAMS = [
  { id:'devconf', title:'개발자 컨퍼런스', emoji:'🧑‍💻' },
  { id:'ai-training', title:'AI 활용 교육', emoji:'🤖' },
  { id:'leaders', title:'직책자 대상 교육', emoji:'🏷️' },
  { id:'launch', title:'런칭 세션', emoji:'🚀' },
];
async function ensureProgramsSeeded(){
  const snap = await getDocs(collection(db, 'programs'));
  if(snap.empty){
    for(const p of DEFAULT_PROGRAMS){
      await setDoc(doc(db, 'programs', p.id), { title:p.title, emoji:p.emoji, createdAt:Date.now() });
      await setDoc(doc(db,'programs',p.id,'meta','summary'), { widgetNote:'요약 위젯', updatedAt:Date.now() });
      await setDoc(doc(db,'programs',p.id,'meta','schema'), { sections: DEFAULT_SCHEMA.sections, updatedAt: Date.now() }, { merge:true });
      for(const y of ['2021','2022','2023','2024']){
        await setDoc(doc(db,'programs',p.id,'years',y), {
          budget:{ items:[] }, design:{ note:'', assetLinks:[] }, outcome:{ surveySummary:{}, analysis:'' }, content:{ outline:'' }, updatedAt:Date.now()
        });
      }
      await setDoc(doc(db,'programs',p.id,'years','single'), {
        budget:{ details:'' }, design:{ note:'', assetLinks:[] }, outcome:{ analysis:'' }, content:{ outline:'' }, updatedAt:Date.now()
      });
    }
  }
}

/* ===== 홈 ===== */
async function renderHome(){
  appEl.innerHTML = `
    <section class="container">
      <div class="toolbar">
        <h2>교육 카테고리</h2>
        <div class="row"><button id="addProg" class="btn">카테고리 추가</button></div>
      </div>

      <section id="homeDashboard" style="margin-bottom:18px;"></section>

      <!-- 검색 (구글 스타일 pill) -->
      <section class="search-wrap">
        <div class="search-bar">
          <svg class="search-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27a6.471 6.471 0 0 0 1.57-4.23C15.99 6.01 13.98 4 11.49 4S7 6.01 7 9.5 9.01 15 11.5 15a6.5 6.5 0 0 0 4.23-1.57l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14Zm-4 0C9.01 14 7 11.99 7 9.5S9.01 5 11.5 5 16 7.01 16 9.5 13.99 14 11.5 14Z"/></svg>
          <input id="searchInput" class="search-input" placeholder="예) 2023 개발자 컨퍼런스 예산 / 다시" />
          <button id="searchClear" class="search-clear" title="지우기">✕</button>
          <button id="searchBtn" class="search-btn">검색</button>
        </div>
        <div id="searchSuggest" class="search-suggest"></div>
        <div id="searchResults" class="search-results"></div>
      </section>

      <div id="cards" class="grid"></div>
    </section>
  `;
  await ensureProgramsSeeded();
  initHomeDashboard(db);

  // 프로그램 카드
  const snap = await getDocs(collection(db, 'programs'));
  const programs = []; snap.forEach(d => programs.push({ id:d.id, ...d.data() }));
  const cards = document.getElementById('cards');
  cards.innerHTML = programs.slice(0,12).map(p => `
    <article class="card" data-id="${p.id}">
      <div class="emoji">${p.emoji || '📘'}</div>
      <div class="title">${p.title || p.id}</div>
      <div class="small muted">클릭하여 이동</div>
    </article>
  `).join('');
  cards.querySelectorAll('.card').forEach(c=>{
    c.addEventListener('click', ()=> location.hash = `#/program/${c.dataset.id}`);
  });

  // 카드 추가
  document.getElementById('addProg').addEventListener('click', async ()=>{
    const id = prompt('프로그램 ID(영문/숫자/하이픈)'); if(!id) return;
    const title = prompt('표시 이름'); if(!title) return;
    const emoji = prompt('이모지(예: 🎯)') || '📘';
    await setDoc(doc(db, 'programs', id), { title, emoji, createdAt:Date.now() });
    await setDoc(doc(db,'programs',id,'meta','schema'), { sections: DEFAULT_SCHEMA.sections, updatedAt: Date.now() }, { merge:true });
    location.reload();
  });

  /* ====== 검색 ====== */
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClear');
  const suggestEl = document.getElementById('searchSuggest');
  const resultsEl = document.getElementById('searchResults');

  // 풀텍스트 인덱스 빌드(프로그램×연도×섹션의 주요 텍스트 모음)
  const index = await buildSearchIndex(programs);

  input.addEventListener('input', ()=>{
    const q = input.value.trim();
    suggestEl.innerHTML = renderSuggestions(q, index)
      .map(s => `<span class="sg" data-q="${s}">${s}</span>`).join('');
    suggestEl.querySelectorAll('.sg').forEach(tag=>{
      tag.addEventListener('click', ()=>{ input.value = tag.dataset.q; doSearch(); });
    });
  });
  clearBtn.addEventListener('click', ()=>{ input.value=''; suggestEl.innerHTML=''; resultsEl.innerHTML=''; });

  document.getElementById('searchBtn').addEventListener('click', ()=> doSearch());
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') doSearch(); });

  function doSearch(){
    const q = input.value.trim();
    const found = search(q, index);
    if(!found.length){
      resultsEl.innerHTML = `<div class="muted small">검색 결과가 없습니다.</div>`;
      return;
    }
    resultsEl.innerHTML = found.map(r => `
      <div class="search-card"
           data-id="${r.programId}" data-focus="${r.focus}" data-year="${r.year||''}">
        <div class="title">${r.title}</div>
        <div class="badges">
          ${r.year ? `<span class="badge">${r.year}</span>` : ``}
          <span class="badge">${r.sectionLabel}</span>
        </div>
        ${r.snippet ? `<div class="small muted" style="margin-top:6px">${r.snippet}</div>` : ``}
      </div>
    `).join('');
    resultsEl.querySelectorAll('.search-card').forEach(el=>{
      el.addEventListener('click', ()=>{
        const id = el.dataset.id;
        const focus = el.dataset.focus;
        const year = el.dataset.year;
        // detail=1 → 상세 모달을 곧장 띄우도록 신호
        const q = `#/program/${id}?focus=${encodeURIComponent(focus)}${year?`&year=${encodeURIComponent(year)}`:''}&detail=1`;
        location.hash = q;
      });
    });
  }
}

/* ===== 검색 인덱스/로직 ===== */
const YEARS_POOL = ['2021','2022','2023','2024','2025','2026'];
const SECTIONS = [
  { id:'items:content', label:'교육 내용', keys:['내용','커리큘럼','아젠다','agenda','content'] },
  { id:'items:budget',  label:'예산',     keys:['예산','비용','견적','budget'] },
  { id:'items:outcome', label:'성과',     keys:['성과','설문','만족도','csat','nps','outcome'] },
  { id:'items:design',  label:'디자인',   keys:['디자인','배너','ppt','pdf','갤러리','design'] },
  { id:'widget:summary',label:'위젯(전체 요약)', keys:['위젯','요약','summary','overview'] },
];

/* 인덱스 텍스트 생성기(사람-읽기 요약) */
function summarizeBudget(budget){
  const items = Array.isArray(budget?.items) ? budget.items : [];
  const lines = items.slice(0,5).map(it=>{
    const name = it?.name || '항목';
    const subtotal = Number(it?.subtotal ?? ((+it?.unitCost||0) * (+it?.qty||0)));
    return `${name} ${nf.format(subtotal)}원`;
  });
  const total = items.reduce((s,it)=> s + Number(it?.subtotal ?? ((+it?.unitCost||0) * (+it?.qty||0))), 0);
  if (lines.length) lines.push(`합계 ${nf.format(total)}원`);
  return lines.join(' · ');
}
function summarizeOutcome(outcome){
  const s = outcome?.surveySummary || {};
  const kpis = Array.isArray(outcome?.kpis) ? outcome.kpis.slice(0,3).map(k=>`${k?.name||''}:${k?.value||''}`).join(' · ') : '';
  const insights = Array.isArray(outcome?.insights) ? outcome.insights.slice(0,2).map(i=>i?.title||'').join(' / ') : '';
  const head = `응답수 ${s?.n||0}, CSAT ${s?.csat ?? '-'}, NPS ${s?.nps ?? '-'}`;
  const tail = [kpis, insights].filter(Boolean).join(' · ');
  return [head, tail].filter(Boolean).join(' — ');
}
function summarizeDesign(design){
  const note = design?.note || '';
  const count = Array.isArray(design?.assetLinks) ? design.assetLinks.length : 0;
  const asset = count ? `이미지 ${count}개` : '';
  return [note, asset].filter(Boolean).join(' · ');
}

// 프로그램/연도 문서의 텍스트를 수집해 간단한 풀텍스트 인덱스 구성 (JSON 노출 금지)
async function buildSearchIndex(programs){
  const contents = [];
  for (const p of programs){
    for (const y of YEARS_POOL.slice(0,4)){ // 기본 2021~2024
      const yref = doc(db,'programs',p.id,'years',y);
      const ysnap = await getDoc(yref);
      if(!ysnap.exists()) continue;
      const v = ysnap.data() || {};
      // 섹션별 "사람-읽기 요약" 텍스트
      contents.push({ programId:p.id, programTitle:p.title||p.id, section:'items:content', sectionLabel:'교육 내용', year:y, text: (v?.content?.outline || '').toString() });
      contents.push({ programId:p.id, programTitle:p.title||p.id, section:'items:budget',  sectionLabel:'예산',     year:y, text: summarizeBudget(v?.budget) });
      contents.push({ programId:p.id, programTitle:p.title||p.id, section:'items:outcome', sectionLabel:'성과',     year:y, text: summarizeOutcome(v?.outcome) });
      contents.push({ programId:p.id, programTitle:p.title||p.id, section:'items:design',  sectionLabel:'디자인',   year:y, text: summarizeDesign(v?.design) });
    }
  }
  return {
    programs: programs.map(p => ({ id:p.id, title:(p.title||p.id), titleLc:(p.title||p.id).toLowerCase() })),
    years: YEARS_POOL,
    sections: SECTIONS,
    contents
  };
}

function renderSuggestions(q, idx){
  if(!q) return [];
  const lc = q.toLowerCase();
  const ys  = idx.years.filter(y => y.includes(q));
  const ps  = idx.programs.filter(p => p.titleLc.includes(lc)).slice(0,4).map(p=>p.title);
  const sec = idx.sections.map(s=>s.keys[0]);
  return [...ys, ...ps, ...sec].slice(0,8);
}

/**
 * 의도: "세부 보기(모달) 후보"를 직접 제공
 *  - 섹션 키워드가 있으면: 섹션 × (지정연도 || 기본연도) × (지정프로그램 || 전체)
 *  - 섹션 키워드 없이 프로그램만 있으면: 그 프로그램의 4개 섹션 × 전체 연도
 *  - 키워드(자유 텍스트)가 있으면: contents 풀텍스트에서 스니펫 매칭
 */
function search(q, idx){
  const lc = q.toLowerCase();

  const progHits = idx.programs.filter(p => p.titleLc.includes(lc));
  const baseProgs = progHits.length ? progHits : idx.programs;

  const years = idx.years.filter(y => q.includes(y));
  const yearsUse = years.length ? years : idx.years.slice(0,4);

  const secHit = idx.sections.find(s => s.keys.some(k => lc.includes(k.toLowerCase())));
  const sectionsUse = secHit
    ? [secHit]
    : (progHits.length ? idx.sections.filter(s => s.id.startsWith('items:')) : []);

  const out = [];

  // 1) 섹션 기반 후보
  if(sectionsUse.length){
    sectionsUse.forEach(sec=>{
      if(sec.id.startsWith('widget:')){
        baseProgs.forEach(p=>{
          out.push({
            programId: p.id, title: `${p.title} · ${sec.label}`,
            focus: sec.id, sectionLabel: sec.label
          });
        });
      }else{
        baseProgs.forEach(p=>{
          (yearsUse.length?yearsUse:[null]).forEach(y=>{
            out.push({
              programId: p.id, title: `${p.title} · ${y||''} ${sec.label}`.trim(),
              focus: sec.id, sectionLabel: sec.label, year: y||''
            });
          });
        });
      }
    });
  }else if(progHits.length){
    // 2) 프로그램만 → 4섹션 × 연도
    idx.sections.filter(s=>s.id.startsWith('items:')).forEach(sec=>{
      progHits.forEach(p=>{
        yearsUse.forEach(y=>{
          out.push({
            programId: p.id, title: `${p.title} · ${y} ${sec.label}`,
            focus: sec.id, sectionLabel: sec.label, year: y
          });
        });
      });
    });
  }

  // 3) 풀텍스트 후보(내용/예산/성과/디자인 텍스트 매칭)
  if(q && !secHit){
    const MAX = 20;
    const hits = idx.contents.filter(c => (c.text||'').toString().toLowerCase().includes(lc)).slice(0,MAX);
    hits.forEach(h=>{
      const snippet = makeSnippet(h.text, q, 90);
      out.push({
        programId: h.programId,
        title: `${h.programTitle} · ${h.year} ${h.sectionLabel}`,
        focus: h.section, sectionLabel: h.sectionLabel, year: h.year,
        snippet
      });
    });
  }

  // 중복 제거 + 상위 40개
  const key = r => `${r.programId}|${r.focus}|${r.year||''}`;
  const seen = new Set();
  return out.filter(r=>{ const k=key(r); if(seen.has(k)) return false; seen.add(k); return true; }).slice(0,40);
}

function makeSnippet(txt, q, span=80){
  const s = (txt||'').toString();
  if(!s) return '';
  const sEsc = esc(s); // 안전하게 이스케이프
  const i = sEsc.toLowerCase().indexOf(esc(q).toLowerCase());
  if(i<0){
    const cut = sEsc.slice(0,span);
    return cut + (sEsc.length>span?'…':'');
  }
  const start = Math.max(0, i - Math.floor(span/2));
  const end   = Math.min(sEsc.length, start + span);
  const head = start>0 ? '…' : '';
  const tail = end<sEsc.length ? '…' : '';
  const mid  = sEsc.slice(start, end);
  // 하이라이트 <mark>
  const regex = new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'ig');
  return head + mid.replace(regex, m=>`<mark>${m}</mark>`) + tail;
}

/* ===== 상세(2 Cuts) + 섹션 스키마 ===== */
async function renderProgramPage(programId, options = {}){
  const progRef = doc(db, 'programs', programId);
  const progSnap = await getDoc(progRef);
  if(!progSnap.exists()){
    appEl.innerHTML = `<section class="container"><p class="err">존재하지 않는 프로그램: ${programId}</p></section>`;
    return;
  }
  const prog = { id: programId, ...progSnap.data() };

  const [singleSnap, summarySnap, schema] = await Promise.all([
    getDoc(doc(db,'programs',programId,'years','single')),
    getDoc(doc(db,'programs',programId,'meta','summary')),
    getProgramSchema(db, programId)
  ]);
  const single  = singleSnap.exists() ? singleSnap.data() : { design:{ assetLinks:[] } };
  const summary = summarySnap.exists() ? summarySnap.data() : {};
  const years = ['2021','2022','2023','2024'];

  appEl.innerHTML = `
    <section class="container">
      <div class="toolbar">
        <a class="link" href="#/home">← 목록</a>
        <h2>${prog.emoji || '📘'} ${prog.title}</h2>
        <div class="row">
          <button id="editSchema" class="btn ghost hidden" style="display:none">섹션 구성</button>
          <button id="toggleEdit" class="btn">편집</button>
          <button id="deleteProgram" class="btn danger hidden" style="display:none">프로그램 삭제</button>
        </div>
      </div>

      <!-- Cut #1: 위젯 -->
      <section class="cut cut-1" id="cut-widgets">
        <div class="cut-hd">위젯 <span class="sub">(전체 요약)</span></div>
        <div id="cut1-widgets"></div>
      </section>

      <!-- Cut #2: 항목별 페이지 -->
      <section class="cut cut-2" id="cut-items">
        <div class="cut-hd">항목별 페이지</div>
        <div class="divider"></div>
        <div id="cut2-items"></div>
      </section>
    </section>
  `;

  // 편집 토글
  let editMode = !!options.resumeEdit;
  const btnEdit  = document.getElementById('toggleEdit');
  const btnSchema= document.getElementById('editSchema');
  const btnDel   = document.getElementById('deleteProgram');

  const applyEditMode = ()=>{
    btnEdit.textContent = editMode ? '편집 종료' : '편집';
    [btnSchema, btnDel].forEach(el=>{
      el.classList.toggle('hidden', !editMode);
      el.style.display = editMode ? '' : 'none';
    });
    updateWidgetEditMode(editMode);
    updateItemEditMode(editMode);
  };

  btnEdit.addEventListener('click', ()=>{
    if (!editMode){ editMode = true; applyEditMode(); return; }
    const ok = confirm('편집을 완료하고 저장하시겠습니까?');
    if(!ok) return;
    alert('저장 완료');
    editMode = false; applyEditMode();
  });

  // 섹션 구성
  btnSchema.addEventListener('click', async ()=>{
    const schemaNow = await getProgramSchema(db, programId);
    await openSchemaEditor(db, programId, schemaNow, async ()=>{
      const freshSchema = await getProgramSchema(db, programId);
      await renderWidgetSection({ db, storage, programId, mount:document.getElementById('cut1-widgets'), summary, single, years, schema:freshSchema });
      await renderItemSection  ({ db, storage, programId, mount:document.getElementById('cut2-items'),   years, schema:freshSchema });
      editMode = true; applyEditMode();
    });
  });

  // 프로그램 삭제
  btnDel.addEventListener('click', async ()=>{
    const code = prompt('프로그램 삭제 확인 코드(ahnlabhr0315)'); if(code!=='ahnlabhr0315') return alert('코드가 일치하지 않습니다.');
    if(!confirm('정말 삭제할까요?')) return;
    try{
      try{
        const folderRef = ref(storage, `programs/${programId}/design`);
        const all = await listAll(folderRef);
        await Promise.all(all.items.map(i => deleteObject(i)));
      }catch(e){}
      for(const y of years){ await deleteDoc(doc(db,'programs',programId,'years',y)); }
      await deleteDoc(doc(db,'programs',programId,'meta','summary'));
      await deleteDoc(doc(db,'programs',programId,'meta','schema'));
      await deleteDoc(doc(db,'programs',programId));
      alert('삭제되었습니다.'); location.hash = '#/home';
    }catch(e){ console.error(e); alert('삭제 중 오류'); }
  });

  // 최초 렌더
  await renderWidgetSection({ db, storage, programId, mount:document.getElementById('cut1-widgets'), summary, single, years, schema });
  await renderItemSection  ({ db, storage, programId, mount:document.getElementById('cut2-items'),   years, schema });

  applyEditMode();

  /* ===== 포커스 & 상세 열기 ===== */
  if (options.focus){
    const isWidget = String(options.focus).startsWith('widget:');
    const targetCut = document.getElementById(isWidget ? 'cut-widgets' : 'cut-items');
    if(targetCut){
      targetCut.classList.add('focus-flash');
      targetCut.scrollIntoView({ behavior:'smooth', block:'start' });
      setTimeout(()=> targetCut.classList.remove('focus-flash'), 1700);
    }
    // 상세 모달 직접 열기: items 섹션만
    if (options.openDetail && !isWidget){
      // 섹션/연도 전달
      window.dispatchEvent(new CustomEvent('hrd:open-detail', {
        detail: { section: options.focus, year: options.year || '' }
      }));
    }
  }
}
