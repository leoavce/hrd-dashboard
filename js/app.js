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

// ★ 신규: 스키마 모듈
import { getProgramSchema, SECTION_DEFS, DEFAULT_SCHEMA } from "./programSchema.js";

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

// ---------- 초기 시드 ----------
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
      // 기본 스키마 저장
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
      <div id="cards" class="grid"></div>
    </section>
  `;
  await ensureProgramsSeeded();
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
    // 기본 스키마 부여
    await setDoc(doc(db,'programs',id,'meta','schema'), { sections: DEFAULT_SCHEMA.sections, updatedAt: Date.now() }, { merge:true });
    location.reload();
  });
}

// ---------- 상세 (스키마 기반 동적 렌더) ----------
async function renderProgramPage(programId){
  const progRef = doc(db, 'programs', programId);
  const progSnap = await getDoc(progRef);
  if(!progSnap.exists()){
    appEl.innerHTML = `<section class="container"><p class="err">존재하지 않는 프로그램: ${programId}</p></section>`;
    return;
  }
  const prog = { id: programId, ...progSnap.data() };

  // 데이터 프리페치
  const [singleSnap, summarySnap, schema] = await Promise.all([
    getDoc(doc(db, 'programs', programId, 'years', 'single')),
    getDoc(doc(db, 'programs', programId, 'meta', 'summary')),
    getProgramSchema(db, programId)
  ]);

  const single = singleSnap.exists() ? singleSnap.data() : { design:{ assetLinks:[] } };
  const summary = summarySnap.exists() ? summarySnap.data() : {};
  const sections = schema.sections && schema.sections.length ? schema.sections : DEFAULT_SCHEMA.sections;

  // 섹션별 HTML 조립
  const htmlChunks = [];

  // 툴바
  htmlChunks.push(`
    <section class="container">
      <div class="toolbar">
        <a class="link" href="#/home">← 목록</a>
        <h2>${prog.emoji || '📘'} ${prog.title}</h2>
        <div class="row">
          <button id="toggleEdit" class="btn" title="보기/편집 전환">편집</button>
          <button id="deleteProgram" class="btn danger" title="전체 삭제(연도/자산 포함)">프로그램 삭제</button>
        </div>
      </div>
  `);

  // widget
  if (sections.includes('widget')) {
    htmlChunks.push(`
      <section class="section">
        <h3>${SECTION_DEFS['widget'].title}</h3>
        <textarea id="widgetNote" placeholder="예산/디자인/성과/내용 요약">${summary.widgetNote || ''}</textarea>
        <div class="row">
          <button id="saveWidget" class="btn">저장</button>
        </div>
      </section>
    `);
  }

  // 단일 항목 묶음: 필요 섹션이 하나라도 있으면 묶어서 출력
  const singleIds = sections.filter(s => s.startsWith('single:'));
  if (singleIds.length) {
    htmlChunks.push(`<section class="section"><h3>항목별 단일 페이지</h3>`);
    if (singleIds.includes('single:budget')) {
      htmlChunks.push(`<div class="kv"><strong>${SECTION_DEFS['single:budget'].title}</strong><textarea id="budgetDetails" placeholder="평균 예산 및 지출 항목">${single?.budget?.details || ''}</textarea></div>`);
    }
    if (singleIds.includes('single:design')) {
      htmlChunks.push(`
        <div class="kv"><strong>${SECTION_DEFS['single:design'].title}</strong>
          <div>
            <input id="designNote" placeholder="디자인 설명/비고" value="${single?.design?.note || ''}" />
            <div class="row">
              <input type="file" id="designFile" />
              <button class="btn" id="uploadDesign">파일 업로드</button>
            </div>
            <div class="asset-list" id="designAssets"></div>
          </div>
        </div>
      `);
    }
    if (singleIds.includes('single:outcome')) {
      htmlChunks.push(`<div class="kv"><strong>${SECTION_DEFS['single:outcome'].title}</strong><textarea id="outcomeAnalysis" placeholder="설문 데이터 분석 요약">${single?.outcome?.analysis || ''}</textarea></div>`);
    }
    if (singleIds.includes('single:content')) {
      htmlChunks.push(`<div class="kv"><strong>${SECTION_DEFS['single:content'].title}</strong><textarea id="contentOutline" placeholder="강의/세션 구성 요약">${single?.content?.outline || ''}</textarea></div>`);
    }
    htmlChunks.push(`<div class="row"><button id="saveItems" class="btn">저장</button></div></section>`);
  }

  // 연도별
  if (sections.includes('yearly')) {
    htmlChunks.push(`
      <section class="section">
        <h3>${SECTION_DEFS['yearly'].title}</h3>
        <div class="row">
          <select id="yearSel">
            <option value="2021">2021</option>
            <option value="2022">2022</option>
            <option value="2023">2023</option>
            <option value="2024" selected>2024</option>
          </select>
          <button id="clearYear" class="btn danger">해당 연도 비우기</button>
        </div>
        <div class="kv"><strong>예산</strong><textarea id="yBudget"></textarea></div>
        <div class="kv"><strong>디자인</strong><textarea id="yDesign"></textarea></div>
        <div class="kv"><strong>교육 성과</strong><textarea id="yOutcome"></textarea></div>
        <div class="kv"><strong>교육 내용</strong><textarea id="yContent"></textarea></div>
        <div class="row"><button id="saveYear" class="btn">연도별 저장</button></div>
      </section>
    `);
  }

  // container 닫기
  htmlChunks.push(`</section>`);
  appEl.innerHTML = htmlChunks.join('\n');

  // === 편집 모드 ===
  let editMode = false;
  const toggleBtn = document.getElementById('toggleEdit');

  function applyEditMode() {
    const textareaIds = [
      'widgetNote','budgetDetails','outcomeAnalysis','contentOutline',
      'yBudget','yDesign','yOutcome','yContent'
    ];
    const inputIds = ['designNote'];

    textareaIds.forEach(id=>{
      const el = document.getElementById(id);
      if(!el) return;
      el.readOnly = !editMode;
      el.classList.toggle('readonly', !editMode);
    });
    inputIds.forEach(id=>{
      const el = document.getElementById(id);
      if(!el) return;
      el.disabled = !editMode;
      el.classList.toggle('readonly', !editMode);
    });

    // 파일/저장 버튼들 존재할 때만 토글
    ['designFile','uploadDesign','saveItems','saveWidget','saveYear','clearYear'].forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.classList.toggle('hidden', !editMode);
    });

    // 자산 삭제 버튼 가시성 재렌더 (디자인 섹션 있는 경우에만)
    const assetsWrap = document.getElementById('designAssets');
    if (assetsWrap) {
      const currentAssets = Array.from(assetsWrap.querySelectorAll('.asset-item')).map(div=>div.dataset.url);
      renderAssetLinks(currentAssets || []);
    }

    if (toggleBtn) toggleBtn.textContent = editMode ? '편집 종료' : '편집';
  }

  // --- 편집 토글 (편집 종료 시 저장 확인) ---
  toggleBtn.addEventListener('click', async ()=>{
    if (!editMode) { editMode = true; applyEditMode(); return; }
    const ok = confirm('편집을 완료하고 저장하시겠습니까?');
    if (!ok) return;
    try{
      await saveAllEdits(); // 아래 정의
      alert('저장 완료');
      editMode = false;
      applyEditMode();
    }catch(e){
      console.error(e);
      alert('저장 중 오류가 발생했습니다.');
    }
  });

  // --- 디자인 자산 렌더/삭제 (디자인 섹션 있을 때만) ---
  const assetsBox = document.getElementById('designAssets');
  if (assetsBox) {
    renderAssetLinks(single?.design?.assetLinks || []);
  }
  function renderAssetLinks(list){
    if (!assetsBox) return;
    assetsBox.innerHTML = (list && list.length) ? list.map(url => `
      <div class="asset-item" data-url="${url}">
        <a href="${url}" target="_blank">${url}</a>
        <button class="btn danger del-asset ${editMode ? '' : 'hidden'}">삭제</button>
      </div>
    `).join('') : `<div class="small muted">첨부된 디자인 자산이 없습니다.</div>`;

    if(editMode){
      assetsBox.querySelectorAll('.del-asset').forEach(btn=>{
        btn.addEventListener('click', ()=> deleteAsset(btn.parentElement.dataset.url));
      });
    }
  }

  async function deleteAsset(url){
    if(!confirm('이 파일을 삭제할까요? (Storage에서도 삭제됩니다)')) return;
    try{
      const fileRef = ref(storage, url);
      await deleteObject(fileRef);
      const target = doc(db, 'programs', programId, 'years', 'single');
      await updateDoc(target, { 'design.assetLinks': arrayRemove(url) });
      const after = (await getDoc(target)).data()?.design?.assetLinks || [];
      renderAssetLinks(after);
      alert('삭제되었습니다.');
    }catch(e){
      console.error(e); alert('삭제 중 오류가 발생했습니다.');
    }
  }

  // --- 위젯 저장 (존재 시) ---
  const saveWidgetBtn = document.getElementById('saveWidget');
  if (saveWidgetBtn) {
    saveWidgetBtn.addEventListener('click', async ()=>{
      if(!editMode) return alert('편집 모드에서만 가능합니다.');
      const widgetNote = document.getElementById('widgetNote').value;
      await setDoc(doc(db,'programs',programId,'meta','summary'), { widgetNote, updatedAt:Date.now() }, { merge:true });
      alert('저장 완료');
    });
  }

  // --- 단일 섹션 저장 (존재 시) ---
  const saveItemsBtn = document.getElementById('saveItems');
  if (saveItemsBtn) {
    saveItemsBtn.addEventListener('click', async ()=>{
      if(!editMode) return alert('편집 모드에서만 가능합니다.');
      const payload = { updatedAt: Date.now() };
      const budgetDetailsEl = document.getElementById('budgetDetails');
      const designNoteEl    = document.getElementById('designNote');
      const outcomeEl       = document.getElementById('outcomeAnalysis');
      const contentEl       = document.getElementById('contentOutline');

      if (budgetDetailsEl) payload.budget = { details: budgetDetailsEl.value };
      if (designNoteEl)    payload.design = { ...(payload.design||{}), note: designNoteEl.value };
      if (outcomeEl)       payload.outcome = { analysis: outcomeEl.value };
      if (contentEl)       payload.content = { outline: contentEl.value };

      await setDoc(doc(db,'programs',programId,'years','single'), payload, { merge:true });
      alert('저장 완료');
    });
  }

  // --- 디자인 파일 업로드 (디자인 섹션 있을 때만) ---
  const uploadBtn = document.getElementById('uploadDesign');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', async ()=>{
      if(!editMode) return alert('편집 모드에서만 가능합니다.');
      const file = document.getElementById('designFile').files[0];
      if(!file) return alert('파일을 선택하세요.');
      const r = ref(storage, `programs/${programId}/design/${Date.now()}_${file.name}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      const target = doc(db, 'programs', programId, 'years', 'single');
      await updateDoc(target, { 'design.assetLinks': arrayUnion(url) });
      const after = (await getDoc(target)).data()?.design?.assetLinks || [];
      renderAssetLinks(after);
    });
  }

  // --- 연도별 로드/저장/비우기 (연도 섹션 있을 때만) ---
  const yearSel = document.getElementById('yearSel');
  if (yearSel) {
    yearSel.addEventListener('change', ()=> loadYear(yearSel.value));
    await loadYear(yearSel.value);
  }

  async function loadYear(y){
    const yRef = doc(db,'programs',programId,'years',y);
    const ySnap = await getDoc(yRef);
    if(ySnap.exists()){
      const v = ySnap.data();
      const yBudget  = document.getElementById('yBudget');
      const yDesign  = document.getElementById('yDesign');
      const yOutcome = document.getElementById('yOutcome');
      const yContent = document.getElementById('yContent');
      if (yBudget)  yBudget.value  = v?.budget?.details || '';
      if (yDesign)  yDesign.value  = v?.design?.note || '';
      if (yOutcome) yOutcome.value = v?.outcome?.analysis || '';
      if (yContent) yContent.value = v?.content?.outline || '';
    }else{
      ['yBudget','yDesign','yOutcome','yContent'].forEach(id=>{
        const el = document.getElementById(id); if(el) el.value = '';
      });
    }
  }

  const saveYearBtn = document.getElementById('saveYear');
  if (saveYearBtn) {
    saveYearBtn.addEventListener('click', async ()=>{
      if(!editMode) return alert('편집 모드에서만 가능합니다.');
      const y = document.getElementById('yearSel').value;
      await setDoc(doc(db,'programs',programId,'years',y), {
        budget:{ details: document.getElementById('yBudget').value },
        design:{ note: document.getElementById('yDesign').value },
        outcome:{ analysis: document.getElementById('yOutcome').value },
        content:{ outline: document.getElementById('yContent').value },
        updatedAt: Date.now()
      }, { merge:true });
      alert('연도별 저장 완료');
    });
  }

  const clearYearBtn = document.getElementById('clearYear');
  if (clearYearBtn) {
    clearYearBtn.addEventListener('click', async ()=>{
      if(!editMode) return alert('편집 모드에서만 가능합니다.');
      const y = document.getElementById('yearSel').value;
      if(!confirm(`${y}년 데이터를 비울까요?`)) return;
      await setDoc(doc(db,'programs',programId,'years',y), {
        budget:{ details:'' }, design:{ note:'' }, outcome:{ analysis:'' }, content:{ outline:'' }, updatedAt: Date.now()
      }, { merge:true });
      await loadYear(y);
      alert('해당 연도 내용이 초기화되었습니다.');
    });
  }

  // --- 프로그램 전체 삭제 (확인 코드 필요) ---
  document.getElementById('deleteProgram').addEventListener('click', async ()=>{
    const code = prompt('프로그램 삭제를 진행하려면 확인 코드(ahnlabhr0315)를 입력하세요.');
    if(code !== 'ahnlabhr0315'){ alert('코드가 일치하지 않습니다.'); return; }

    const ok = confirm('정말로 이 프로그램의 모든 데이터를 삭제할까요? (연도/요약/디자인 파일 포함, 복구 불가)');
    if(!ok) return;
    try{
      // 스토리지 파일 제거
      try{
        const folderRef = ref(storage, `programs/${programId}/design`);
        const all = await listAll(folderRef);
        await Promise.all(all.items.map(i => deleteObject(i)));
      }catch(e){ /* 폴더 없을 수 있음 */ }

      // 연도 문서 삭제
      for(const y of ['single','2021','2022','2023','2024']){
        await deleteDoc(doc(db,'programs',programId,'years',y));
      }
      // 메타 삭제
      await deleteDoc(doc(db,'programs',programId,'meta','summary'));
      await deleteDoc(doc(db,'programs',programId,'meta','schema'));

      // 프로그램 문서 삭제
      await deleteDoc(doc(db,'programs',programId));

      alert('프로그램이 삭제되었습니다.');
      location.hash = '#/home';
    }catch(e){
      console.error(e); alert('삭제 중 오류가 발생했습니다.');
    }
  });

  // === 편집 종료 시 한 번에 저장 ===
  async function saveAllEdits(){
    const tasks = [];

    // widget
    const widgetEl = document.getElementById('widgetNote');
    if (widgetEl) {
      tasks.push(setDoc(doc(db,'programs',programId,'meta','summary'), {
        widgetNote: widgetEl.value, updatedAt: Date.now()
      }, { merge:true }));
    }

    // single
    const singlePayload = { updatedAt: Date.now() };
    const budgetDetailsEl = document.getElementById('budgetDetails');
    const designNoteEl    = document.getElementById('designNote');
    const outcomeEl       = document.getElementById('outcomeAnalysis');
    const contentEl       = document.getElementById('contentOutline');

    if (budgetDetailsEl) singlePayload.budget = { details: budgetDetailsEl.value };
    if (designNoteEl)    singlePayload.design = { ...(singlePayload.design||{}), note: designNoteEl.value };
    if (outcomeEl)       singlePayload.outcome = { analysis: outcomeEl.value };
    if (contentEl)       singlePayload.content = { outline: contentEl.value };

    if (Object.keys(singlePayload).length > 1) {
      tasks.push(setDoc(doc(db,'programs',programId,'years','single'), singlePayload, { merge:true }));
    }

    // yearly
    const yearSelEl = document.getElementById('yearSel');
    if (yearSelEl) {
      const y = yearSelEl.value;
      tasks.push(setDoc(doc(db,'programs',programId,'years',y), {
        budget:{ details: document.getElementById('yBudget').value },
        design:{ note: document.getElementById('yDesign').value },
        outcome:{ analysis: document.getElementById('yOutcome').value },
        content:{ outline: document.getElementById('yContent').value },
        updatedAt: Date.now()
      }, { merge:true }));
    }

    await Promise.all(tasks);
  }

  // 초기 상태: 보기 모드
  applyEditMode();
}
