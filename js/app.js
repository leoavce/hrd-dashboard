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
function route(){
  const hash = location.hash || '#/home';
  const [head, page, idAndQuery] = hash.split('/');
  if(page === 'program' && idAndQuery){
    const [id] = idAndQuery.split('?');
    renderProgramPage(id);
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
          budget:{ items:[] }, design:{ note:'', assetLinks:[] }, outcome:{ surveySummary:{} }, content:{ outline:'' }, updatedAt:Date.now()
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

      <!-- 검색 -->
      <section class="panel" style="margin:12px 0;">
        <div class="panel-hd" style="display:flex; align-items:center; gap:10px;">
          <input id="searchInput" placeholder="예) 2023 개발자 컨퍼런스 예산" style="flex:1" />
          <button class="btn" id="searchBtn">돋보기</button>
        </div>
        <div id="searchSuggest" class="small muted" style="margin-top:8px;"></div>
        <div id="searchResults" style="margin-top:10px;"></div>
      </section>

      <div id="cards" class="grid"></div>
    </section>
  `;
  await ensureProgramsSeeded();
  initHomeDashboard(db);

  // 프로그램 카드
  const snap = await getDocs(collection(db, 'programs'));
  const list = []; snap.forEach(d => list.push({ id:d.id, ...d.data() }));
  const cards = document.getElementById('cards');
  cards.innerHTML = list.slice(0,12).map(p => `
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
  const suggest = document.getElementById('searchSuggest');
  const results = document.getElementById('searchResults');

  const index = buildSearchIndex(list);

  input.addEventListener('input', ()=>{
    const q = input.value.trim();
    suggest.innerHTML = renderSuggestions(q, index).join(' ');
  });

  document.getElementById('searchBtn').addEventListener('click', ()=> doSearch());
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') doSearch(); });

  function doSearch(){
    const q = input.value.trim();
    const found = search(q, index);
    if(!found.length){
      results.innerHTML = `<div class="muted small">검색 결과가 없습니다.</div>`;
      return;
    }
    results.innerHTML = found.map(r => `
      <div class="card" style="cursor:pointer" data-id="${r.programId}">
        <div class="title">${r.programTitle}</div>
        <div class="small muted">${r.label}</div>
      </div>
    `).join('');
    results.querySelectorAll('.card').forEach(el=>{
      el.addEventListener('click', ()=>{
        location.hash = `#/program/${el.dataset.id}`;
      });
    });
  }
}

/* 검색 인덱스/로직 */
function buildSearchIndex(programs){
  const years = ['2021','2022','2023','2024','2025','2026'];
  return {
    programs: programs.map(p => ({ id:p.id, title:(p.title||p.id), titleLc:(p.title||p.id).toLowerCase() })),
    years
  };
}
function renderSuggestions(q, idx){
  if(!q) return [];
  const lc = q.toLowerCase();
  const ys = idx.years.filter(y => y.includes(q));
  const ps = idx.programs.filter(p => p.titleLc.includes(lc)).slice(0,5).map(p=>p.title);
  return [...ys, ...ps].map(s=>`<span class="btn small ghost">${s}</span>`);
}
function search(q, idx){
  const lc = q.toLowerCase();
  const year = idx.years.find(y => q.includes(y));
  const program = idx.programs.find(p => p.titleLc.includes(lc));
  const sectionMap = [
    { key:'예산',   label:'예산 상세' },
    { key:'성과',   label:'성과 상세' },
    { key:'디자인', label:'디자인 상세' },
    { key:'내용',   label:'교육 내용 상세' },
  ];
  const sec = sectionMap.find(s => q.includes(s.key));
  const label = [
    year ? `${year}년` : '',
    program ? program.title : '',
    sec ? sec.label : '상세 보기'
  ].filter(Boolean).join(' · ');
  if(program) return [{ programId: program.id, programTitle: program.title, label }];
  // 프로그램을 찾지 못했으면 전체 프로그램으로 제안
  return idx.programs.map(p=>({ programId:p.id, programTitle:p.title, label: year ? `${year}년 · ${p.title}` : p.title })).slice(0,6);
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
      <section class="cut cut-1">
        <div class="cut-hd">위젯 <span class="sub">(전체 요약)</span></div>
        <div id="cut1-widgets"></div>
      </section>

      <!-- Cut #2: 항목별 페이지 -->
      <section class="cut cut-2">
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
    // 편집 중에만 두 버튼 노출 (hidden 클래스 + display 제어 모두)
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

  // 섹션 구성(편집 중에만 표시되므로 안전)
  btnSchema.addEventListener('click', async ()=>{
    const schemaNow = await getProgramSchema(db, programId);
    await openSchemaEditor(db, programId, schemaNow, async ()=>{
      const freshSchema = await getProgramSchema(db, programId);
      await renderWidgetSection({ db, storage, programId, mount:document.getElementById('cut1-widgets'), summary, single, years, schema:freshSchema });
      await renderItemSection  ({ db, storage, programId, mount:document.getElementById('cut2-items'),   years, schema:freshSchema });
      editMode = true; applyEditMode();
    });
  });

  // 프로그램 삭제(편집 중에만 활성화)
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
}
