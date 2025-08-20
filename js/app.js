// js/app.js
import { auth, db, storage } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, doc, getDoc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, deleteObject, listAll } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// 스키마 & 섹션 구성(기존)
import { getProgramSchema, DEFAULT_SCHEMA } from "./programSchema.js";
import { openSchemaEditor } from "./schemaUI.js";
// 진행/준비중 대시보드(기존)
import { initHomeDashboard } from "./ongoingDashboard.js";

// 신규 섹션 모듈 (업데이트됨)
import { renderWidgetSection, updateWidgetEditMode } from "./sections/section-widgets.js";
import { renderItemSection,   updateItemEditMode   } from "./sections/section-items.js";
import { renderYearSection,   updateYearEditMode   } from "./sections/section-years.js";

// ---- 전역 테마 주입 (AhnLab 톤 + 레이아웃 확장, 섹션 간격 강화) ----
(function injectTheme(){
  if (document.getElementById('ahn-theme')) return;
  const s = document.createElement('style'); s.id='ahn-theme';
  s.textContent = `
    :root{
      --ahn-bg:#224c8a;            /* hero 등 짙은 파랑 */
      --ahn-surface:#ffffff;       /* 카드 배경 */
      --ahn-surface-2:#f5f7fb;     /* 연한 카드/표 줄 */
      --ahn-line:#d7e2f1;          /* 경계선 */
      --ahn-text:#0f1c2e;          /* 본문 텍스트 */
      --ahn-muted:#5d718f;         /* 보조 텍스트 */
      --ahn-primary:#2f6fcb;       /* 포인트 파랑 */
      --ahn-primary-weak:#e7f0ff;  /* 연한 포인트 */
    }
    body{ color:var(--ahn-text) }
    .container{ max-width:1280px !important; }
    /* 섹션 간격 강화 */
    #sec-widgets, #sec-items, #sec-years{ margin-top:18px; margin-bottom:18px; }
    /* 기존 다크 계열 버튼/카드 대비를 흰 카드로 */
    .card,.section,.it-sec,.yr{ background:var(--ahn-surface) !important; border-color:var(--ahn-line) !important; }
    .btn{ background:var(--ahn-primary-weak); color:var(--ahn-text); border:1px solid var(--ahn-line); }
    .btn.danger{ background:#ffeceb; color:#8c1a12; border-color:#ffd3cf; }
    .btn.ghost{ background:#fff; }
    .link{ color:var(--ahn-primary) }
  `;
  document.head.appendChild(s);
})();

// ---------- 접근 가드 ----------
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
      <section id="homeDashboard" style="margin-bottom:18px;"></section>
      <div id="cards" class="grid"></div>
    </section>
  `;
  await ensureProgramsSeeded();
  initHomeDashboard(db);

  const snap = await getDocs(collection(db, 'programs'));
  const list = []; snap.forEach(d => list.push({ id:d.id, ...d.data() }));
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
    const id = prompt('프로그램 ID'); if(!id) return;
    const title = prompt('표시 이름'); if(!title) return;
    const emoji = prompt('이모지(예: 🎯)') || '📘';
    await setDoc(doc(db,'programs',id), { title, emoji, createdAt:Date.now() });
    await setDoc(doc(db,'programs',id,'meta','schema'), { sections: DEFAULT_SCHEMA.sections, updatedAt: Date.now() }, { merge:true });
    location.reload();
  });
}

// ---------- 상세 ----------
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

      <div id="sec-widgets"></div>
      <div id="sec-items"></div>
      <div id="sec-years"></div>
    </section>
  `;

  // 편집 모드
  let editMode = !!options.resumeEdit;
  const applyEditMode = ()=>{
    document.getElementById('editSchema')?.classList.toggle('hidden', !editMode);
    document.getElementById('toggleEdit').textContent = editMode ? '편집 종료' : '편집';
    updateWidgetEditMode(editMode);
    updateItemEditMode(editMode);
    updateYearEditMode(editMode);
  };
  document.getElementById('toggleEdit').addEventListener('click', ()=>{
    if (!editMode){ editMode = true; applyEditMode(); return; }
    const ok = confirm('편집을 완료하고 저장하시겠습니까?');
    if(!ok) return;
    alert('저장 완료');
    editMode = false; applyEditMode();
  });

  // 섹션 구성 모달
  document.getElementById('editSchema')?.addEventListener('click', ()=>{
    openSchemaEditor(db, programId, () => renderProgramPage(programId, { resumeEdit:true }));
    const iv=setInterval(()=>{
      const s=document.getElementById('schemaSave'), c=document.getElementById('schemaClose');
      if(!s) return; clearInterval(iv);
      const guard=(e)=>{ if(!confirm('섹션 구성을 완료 및 저장하시겠습니까?')){ e.preventDefault(); e.stopPropagation(); } };
      s.addEventListener('click', guard, true); c?.addEventListener('click', ()=> s.removeEventListener('click', guard, true), {once:true});
    },30);
  });

  // 삭제
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

  // 섹션 렌더
  await renderWidgetSection({ db, storage, programId, mount:document.getElementById('sec-widgets'), summary, single, years });
  await renderItemSection  ({ db, storage, programId, mount:document.getElementById('sec-items'),   years });
  await renderYearSection  ({ db, storage, programId, mount:document.getElementById('sec-years'),   years });

  applyEditMode();
}
