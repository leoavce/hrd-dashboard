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
  const [_, page, id] = hash.split('/');
  if(page === 'program' && id){ renderProgramPage(id); }
  else { renderHome(); }
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
      <div id="cards" class="grid"></div>
    </section>
  `;
  await ensureProgramsSeeded();
  initHomeDashboard(db);

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

  document.getElementById('addProg').addEventListener('click', async ()=>{
    const id = prompt('프로그램 ID(영문/숫자/하이픈)'); if(!id) return;
    const title = prompt('표시 이름'); if(!title) return;
    const emoji = prompt('이모지(예: 🎯)') || '📘';
    await setDoc(doc(db, 'programs', id), { title, emoji, createdAt:Date.now() });
    await setDoc(doc(db,'programs',id,'meta','schema'), { sections: DEFAULT_SCHEMA.sections, updatedAt: Date.now() }, { merge:true });
    location.reload();
  });
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
          <button id="editSchema" class="btn ghost">섹션 구성</button>
          <button id="toggleEdit" class="btn">편집</button>
          <button id="deleteProgram" class="btn danger">프로그램 삭제</button>
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
  const applyEditMode = ()=>{
    document.getElementById('toggleEdit').textContent = editMode ? '편집 종료' : '편집';
    updateWidgetEditMode(editMode);
    updateItemEditMode(editMode);
  };
  document.getElementById('toggleEdit').addEventListener('click', ()=>{
    if (!editMode){ editMode = true; applyEditMode(); return; }
    const ok = confirm('편집을 완료하고 저장하시겠습니까?');
    if(!ok) return;
    alert('저장 완료'); editMode = false; applyEditMode();
  });

  // 섹션 구성(체크박스 ON/OFF) → 저장 → 재렌더(편집 유지)
  document.getElementById('editSchema').addEventListener('click', async ()=>{
    await openSchemaEditor(db, programId, schema, async ()=>{
      // 저장 후 최신 스키마로 갱신 렌더
      const freshSchema = await getProgramSchema(db, programId);
      await renderWidgetSection({ db, storage, programId, mount:document.getElementById('cut1-widgets'), summary, single, years, schema:freshSchema });
      await renderItemSection  ({ db, storage, programId, mount:document.getElementById('cut2-items'),   years, schema:freshSchema });
      editMode = true; applyEditMode();
    });
  });

  // 프로그램 삭제
  document.getElementById('deleteProgram').addEventListener('click', async ()=>{
    const code = prompt('프로그램 삭제 확인 코드(ahnlabhr0315)'); if(code!=='ahnlabhr0315') return alert('코드 불일치');
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
