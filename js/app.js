// js/app.js
import { auth, db, storage } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc,
  arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL, deleteObject, listAll
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// 스키마 모듈 & UI
import { getProgramSchema, SECTION_DEFS, DEFAULT_SCHEMA } from "./programSchema.js";
import { openSchemaEditor } from "./schemaUI.js";

// 진행/준비중 대시보드
import { initHomeDashboard } from "./ongoingDashboard.js";

// 신규 섹션 모듈
import { renderWidgetSection, updateWidgetEditMode } from "./sections/section-widgets.js";
import { renderItemSection,   updateItemEditMode   } from "./sections/section-items.js";
import { renderYearSection,   updateYearEditMode   } from "./sections/section-years.js";

// ---------- 접근 가드 ----------
onAuthStateChanged(auth, (user)=>{
  if(!user){
    location.replace('index.html');
    return;
  }
  boot();
});

async function boot(){
  const userEmail = document.getElementById('userEmail');
  const logoutBtn = document.getElementById('logoutBtn');
  userEmail.textContent = auth.currentUser?.email || '';
  logoutBtn.addEventListener('click', async ()=>{
    try{
      await signOut(auth);
      location.replace('index.html');
    }catch(e){ console.error(e); }
  });

  window.addEventListener('hashchange', route);
  route();
}

// ---------- 라우터 ----------
const appEl = document.getElementById('app');
function route(){
  const hash = location.hash || '#/home';
  const [_, page, id] = hash.split('/');
  if(page === 'program' && id){ renderProgramPage(id); }
  else { renderHome(); }
}

// ---------- 시드 ----------
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
      await setDoc(doc(db, 'programs', p.id, 'meta', 'summary'), { widgetNote:'요약 위젯', updatedAt:Date.now() });
      await setDoc(doc(db,'programs',p.id,'meta','schema'), { sections: DEFAULT_SCHEMA.sections, updatedAt: Date.now() }, { merge:true });
      for(const y of ['2021','2022','2023','2024']){
        await setDoc(doc(db, 'programs', p.id, 'years', y), {
          budget:{ avg:0, details:'' }, design:{ note:'', assetLinks:[] }, outcome:{ analysis:'' }, content:{ outline:'' }, updatedAt:Date.now()
        });
      }
      await setDoc(doc(db, 'programs', p.id, 'years', 'single'), {
        budget:{ details:'' }, design:{ note:'', assetLinks:[] }, outcome:{ analysis:'' }, content:{ outline:'' }, updatedAt:Date.now()
      });
    }
  }
}

// ---------- HOME ----------
async function renderHome(){
  appEl.innerHTML = `
    <section class="container">
      <div class="toolbar">
        <h2>교육 카테고리</h2>
        <div class="row">
          <button id="addProg" class="btn">카테고리 추가</button>
        </div>
      </div>

      <!-- 진행/준비중 대시보드 -->
      <section id="homeDashboard" style="margin-bottom:12px;"></section>

      <div id="cards" class="grid"></div>
    </section>
  `;
  await ensureProgramsSeeded();

  // 홈 대시보드 초기화
  initHomeDashboard(db);

  // 프로그램 카드 렌더
  const snap = await getDocs(collection(db, 'programs'));
  const list = [];
  snap.forEach(d => list.push({ id:d.id, ...d.data() }));

  const cards = document.getElementById('cards');
  cards.innerHTML = list.slice(0,8).map(p => `
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

// ---------- 상세 (스키마 기반 + 3개 섹션 모듈) ----------
async function renderProgramPage(programId, options = {}){
  const progRef = doc(db, 'programs', programId);
  const progSnap = await getDoc(progRef);
  if(!progSnap.exists()){
    appEl.innerHTML = `<section class="container"><p class="err">존재하지 않는 프로그램: ${programId}</p></section>`;
    return;
  }
  const prog = { id: programId, ...progSnap.data() };

  const [singleSnap, summarySnap, schema] = await Promise.all([
    getDoc(doc(db, 'programs', programId, 'years', 'single')),
    getDoc(doc(db, 'programs', programId, 'meta', 'summary')),
    getProgramSchema(db, programId)
  ]);
  const single  = singleSnap.exists() ? singleSnap.data() : { design:{ assetLinks:[] } };
  const summary = summarySnap.exists() ? summarySnap.data() : {};
  const sections = (schema.sections && schema.sections.length) ? schema.sections : DEFAULT_SCHEMA.sections;

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

      <div id="sec-widgets"></div>
      <div id="sec-items"></div>
      <div id="sec-years"></div>
    </section>
  `;

  // === 편집 모드 ===
  let editMode = !!options.resumeEdit;
  const toggleBtn = document.getElementById('toggleEdit');
  const applyEditMode = ()=>{
    // 편집 모드에서만 보이는 버튼들
    ['editSchema'].forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.classList.toggle('hidden', !editMode);
    });
    toggleBtn.textContent = editMode ? '편집 종료' : '편집';

    // 섹션 모듈에 편집 상태 전달
    updateWidgetEditMode(editMode);
    updateItemEditMode(editMode);
    updateYearEditMode(editMode);
  };

  // 토글 동작
  toggleBtn.addEventListener('click', async ()=>{
    if (!editMode) { editMode = true; return applyEditMode(); }
    const ok = confirm('편집을 완료하고 저장하시겠습니까?');
    if (!ok) return;
    // 현재는 섹션 내에서 개별 저장을 운영 — 공통 세이브 필요 시 여기에 추가
    alert('저장 완료');
    editMode = false;
    applyEditMode();
  });

  // 섹션 구성 모달 (저장 후에도 편집 유지)
  document.getElementById('editSchema')?.addEventListener('click', ()=>{
    openSchemaEditor(db, programId, () => renderProgramPage(programId, { resumeEdit: true }));
    // 저장 확인 가드
    const iv = setInterval(()=>{
      const save = document.getElementById('schemaSave');
      const close= document.getElementById('schemaClose');
      if (!save) return;
      clearInterval(iv);
      const guard = (e)=>{
        const ok = confirm('섹션 구성을 완료 및 저장하시겠습니까?');
        if(!ok){ e.preventDefault(); e.stopPropagation(); }
      };
      save.addEventListener('click', guard, true);
      close?.addEventListener('click', ()=> save.removeEventListener('click', guard, true), { once:true });
    }, 30);
  });

  // 삭제
  document.getElementById('deleteProgram').addEventListener('click', async ()=>{
    const code = prompt('프로그램 삭제를 진행하려면 확인 코드(ahnlabhr0315)를 입력하세요.');
    if(code !== 'ahnlabhr0315'){ alert('코드가 일치하지 않습니다.'); return; }
    const ok = confirm('정말로 이 프로그램의 모든 데이터를 삭제할까요? (연도/요약/디자인 파일 포함, 복구 불가)');
    if(!ok) return;
    try{
      try{
        const folderRef = ref(storage, `programs/${programId}/design`);
        const all = await listAll(folderRef);
        await Promise.all(all.items.map(i => deleteObject(i)));
      }catch(e){}
      for(const y of ['single','2021','2022','2023','2024']){
        await deleteDoc(doc(db,'programs',programId,'years',y));
      }
      await deleteDoc(doc(db,'programs',programId,'meta','summary'));
      await deleteDoc(doc(db,'programs',programId,'meta','schema'));
      await deleteDoc(doc(db,'programs',programId));
      alert('프로그램이 삭제되었습니다.');
      location.hash = '#/home';
    }catch(e){
      console.error(e); alert('삭제 중 오류가 발생했습니다.');
    }
  });

  // ====== 섹션 렌더링 ======
  // 1) 위젯(전체 요약)
  await renderWidgetSection({
    db, storage, programId,
    mount: document.getElementById('sec-widgets'),
    summary, single,
    years: ['2021','2022','2023','2024']
  });

  // 2) 항목별
  await renderItemSection({
    db, storage, programId,
    mount: document.getElementById('sec-items'),
    years: ['2021','2022','2023','2024']
  });

  // 3) 년도별
  await renderYearSection({
    db, storage, programId,
    mount: document.getElementById('sec-years'),
    years: ['2021','2022','2023','2024']
  });

  // 편집 버튼 초기 상태 반영
  applyEditMode();
}
