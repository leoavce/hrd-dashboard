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

// ---------- 접근 가드 ----------
onAuthStateChanged(auth, (user)=>{
  if(!user){
    // 인증 해제/미인증 상태 → 로그인 페이지로
    location.replace('index.html');
    return;
  }
  // 로그인 후 앱 초기화
  boot();
});

async function boot(){
  // 헤더 UI
  const userEmail = document.getElementById('userEmail');
  const logoutBtn = document.getElementById('logoutBtn');
  userEmail.textContent = auth.currentUser?.email || '';
  logoutBtn.addEventListener('click', async ()=>{
    try{
      await signOut(auth);
      location.replace('index.html');
    }catch(e){ console.error(e); }
  });

  // 라우팅
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

// ---------- 시드 데이터 ----------
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
    location.reload();
  });
}

// ---------- 상세 ----------
async function renderProgramPage(programId){
  const progRef = doc(db, 'programs', programId);
  const progSnap = await getDoc(progRef);
  if(!progSnap.exists()){
    appEl.innerHTML = `<section class="container"><p class="err">존재하지 않는 프로그램: ${programId}</p></section>`;
    return;
  }
  const prog = { id: programId, ...progSnap.data() };

  // 기존 데이터 로딩 (즉시 표시)
  const singleSnap = await getDoc(doc(db, 'programs', programId, 'years', 'single'));
  const single = singleSnap.exists() ? singleSnap.data() : { design:{ assetLinks:[] } };
  const summarySnap = await getDoc(doc(db, 'programs', programId, 'meta', 'summary'));
  const summary = summarySnap.exists() ? summarySnap.data() : {};

  appEl.innerHTML = `
    <section class="container">
      <div class="toolbar">
        <a class="link" href="#/home">← 목록</a>
        <h2>${prog.emoji || '📘'} ${prog.title}</h2>
        <div class="row">
          <button id="deleteProgram" class="btn danger" title="전체 삭제(연도/자산 포함)">프로그램 삭제</button>
        </div>
      </div>

      <!-- 위젯 -->
      <section class="section">
        <h3>위젯(종합)</h3>
        <textarea id="widgetNote" placeholder="예산/디자인/성과/내용 요약">${summary.widgetNote || ''}</textarea>
        <div class="row">
          <button id="saveWidget" class="btn">저장</button>
        </div>
      </section>

      <!-- 항목별 단일 페이지 -->
      <section class="section">
        <h3>항목별 단일 페이지</h3>
        <div class="kv"><strong>예산</strong><textarea id="budgetDetails" placeholder="평균 예산 및 지출 항목">${single?.budget?.details || ''}</textarea></div>
        <div class="kv"><strong>디자인</strong>
          <div>
            <input id="designNote" placeholder="디자인 설명/비고" value="${single?.design?.note || ''}" />
            <div class="row">
              <input type="file" id="designFile" />
              <button class="btn" id="uploadDesign">파일 업로드</button>
            </div>
            <div class="asset-list" id="designAssets"></div>
          </div>
        </div>
        <div class="kv"><strong>교육 성과</strong><textarea id="outcomeAnalysis" placeholder="설문 데이터 분석 요약">${single?.outcome?.analysis || ''}</textarea></div>
        <div class="kv"><strong>교육 내용</strong><textarea id="contentOutline" placeholder="강의/세션 구성 요약">${single?.content?.outline || ''}</textarea></div>
        <div class="row">
          <button id="saveItems" class="btn">저장</button>
        </div>
      </section>

      <!-- 연도별 -->
      <section class="section">
        <h3>연도별 상세</h3>
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
    </section>
  `;

  // --- 자산 링크 렌더링 + 개별 삭제 ---
  const assetsBox = document.getElementById('designAssets');
  renderAssetLinks(single?.design?.assetLinks || []);
  function renderAssetLinks(list){
    assetsBox.innerHTML = (list || []).map(url => `
      <div class="asset-item" data-url="${url}">
        <a href="${url}" target="_blank">${url}</a>
        <button class="btn danger del-asset">삭제</button>
      </div>
    `).join('') || `<div class="small muted">첨부된 디자인 자산이 없습니다.</div>`;
    assetsBox.querySelectorAll('.del-asset').forEach(btn=>{
      btn.addEventListener('click', ()=> deleteAsset(btn.parentElement.dataset.url));
    });
  }

  async function deleteAsset(url){
    if(!confirm('이 파일을 삭제할까요? (Storage에서도 삭제됩니다)')) return;
    try{
      // Storage 실제 파일 삭제 (URL을 그대로 ref에 넣기)
      const fileRef = ref(storage, url);
      await deleteObject(fileRef);
      // Firestore 리스트에서 제거
      const target = doc(db, 'programs', programId, 'years', 'single');
      await updateDoc(target, { 'design.assetLinks': arrayRemove(url) });
      // UI 갱신
      const after = (await getDoc(target)).data()?.design?.assetLinks || [];
      renderAssetLinks(after);
      alert('삭제되었습니다.');
    }catch(e){
      console.error(e); alert('삭제 중 오류가 발생했습니다.');
    }
  }

  // --- 위젯 저장 ---
  document.getElementById('saveWidget').addEventListener('click', async ()=>{
    const widgetNote = document.getElementById('widgetNote').value;
    await setDoc(doc(db,'programs',programId,'meta','summary'), { widgetNote, updatedAt:Date.now() }, { merge:true });
    alert('저장 완료');
  });

  // --- 단일 페이지 저장 ---
  document.getElementById('saveItems').addEventListener('click', async ()=>{
    const target = doc(db,'programs',programId,'years','single');
    await setDoc(target, {
      budget:{ details: document.getElementById('budgetDetails').value },
      design:{ note: document.getElementById('designNote').value },
      outcome:{ analysis: document.getElementById('outcomeAnalysis').value },
      content:{ outline: document.getElementById('contentOutline').value },
      updatedAt: Date.now()
    }, { merge:true });
    alert('저장 완료');
  });

  // --- 디자인 파일 업로드 (링크를 Firestore 배열로 저장) ---
  document.getElementById('uploadDesign').addEventListener('click', async ()=>{
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

  // --- 연도별 로드/저장/비우기 ---
  const yearSel = document.getElementById('yearSel');
  yearSel.addEventListener('change', ()=> loadYear(yearSel.value));
  await loadYear(yearSel.value);

  async function loadYear(y){
    const yRef = doc(db,'programs',programId,'years',y);
    const ySnap = await getDoc(yRef);
    if(ySnap.exists()){
      const v = ySnap.data();
      document.getElementById('yBudget').value = v?.budget?.details || '';
      document.getElementById('yDesign').value = v?.design?.note || '';
      document.getElementById('yOutcome').value = v?.outcome?.analysis || '';
      document.getElementById('yContent').value = v?.content?.outline || '';
    }else{
      document.getElementById('yBudget').value =
      document.getElementById('yDesign').value =
      document.getElementById('yOutcome').value =
      document.getElementById('yContent').value = '';
    }
  }

  document.getElementById('saveYear').addEventListener('click', async ()=>{
    const y = yearSel.value;
    const yRef = doc(db,'programs',programId,'years',y);
    await setDoc(yRef, {
      budget:{ details: document.getElementById('yBudget').value },
      design:{ note: document.getElementById('yDesign').value },
      outcome:{ analysis: document.getElementById('yOutcome').value },
      content:{ outline: document.getElementById('yContent').value },
      updatedAt: Date.now()
    }, { merge:true });
    alert('연도별 저장 완료');
  });

  document.getElementById('clearYear').addEventListener('click', async ()=>{
    const y = yearSel.value;
    if(!confirm(`${y}년 데이터를 비울까요?`)) return;
    const yRef = doc(db,'programs',programId,'years',y);
    await setDoc(yRef, {
      budget:{ details:'' }, design:{ note:'' }, outcome:{ analysis:'' }, content:{ outline:'' }, updatedAt: Date.now()
    }, { merge:true });
    await loadYear(y);
    alert('해당 연도 내용이 초기화되었습니다.');
  });

  // --- 프로그램 전체 삭제 (연도/메타/스토리지 자산) ---
  document.getElementById('deleteProgram').addEventListener('click', async ()=>{
    const ok = confirm('이 프로그램의 모든 데이터를 삭제할까요? (연도/요약/디자인 파일 포함)');
    if(!ok) return;
    try{
      // 1) 연도 문서 삭제 (single + 2021-2024)
      for(const y of ['single','2021','2022','2023','2024']){
        await deleteDoc(doc(db,'programs',programId,'years',y));
      }
      // 2) meta/summary 삭제
      await deleteDoc(doc(db,'programs',programId,'meta','summary'));
      // 3) storage 폴더 내 파일 삭제
      const folderRef = ref(storage, `programs/${programId}/design`);
      try{
        const all = await listAll(folderRef);
        await Promise.all(all.items.map(i => deleteObject(i)));
      }catch(e){ /* 폴더가 없을 수 있으니 무시 */ }
      // 4) program 문서 삭제
      await deleteDoc(doc(db,'programs',programId));
      alert('프로그램이 삭제되었습니다.');
      location.hash = '#/home';
    }catch(e){
      console.error(e); alert('삭제 중 오류가 발생했습니다.');
    }
  });
}
