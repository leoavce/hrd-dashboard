// js/app.js
// Firebase 모듈에서 auth/db/storage만 가져다 씀 (getAuth 호출 금지)
import { auth, db, storage } from "./firebase.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// ====== 공통 요소 ======
const appEl = document.getElementById("app");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginDialog = document.getElementById("loginDialog");
const loginForm = document.getElementById("loginForm");
const loginErr = document.getElementById("loginErr");
const closeLogin = document.getElementById("closeLogin");
const userEmail = document.getElementById("userEmail");

loginBtn.addEventListener("click", () => loginDialog.showModal());
closeLogin.addEventListener("click", () => loginDialog.close());

// 로그인
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginErr.textContent = "";
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    loginDialog.close();
  } catch (err) {
    loginErr.textContent = err.message;
  }
});

// 로그아웃 (여기가 핵심 수정 포인트: 반드시 await, 단일 auth 인스턴스)
logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
    // UI 리셋 및 홈으로 이동
    userEmail.textContent = "";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    if (loginDialog.open) loginDialog.close();
    location.hash = "#/home";
  } catch (e) {
    console.error("logout error:", e);
  }
});

// 상태 변화에 따라 버튼/라우팅 갱신
onAuthStateChanged(auth, (user) => {
  if (user) {
    userEmail.textContent = user.email || "";
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
  } else {
    userEmail.textContent = "";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
  }
  route();
});

// ====== 라우터 ======
window.addEventListener("hashchange", route);
function route() {
  const hash = location.hash || "#/home";
  const [_, page, id] = hash.split("/");
  if (page === "program" && id) renderProgramPage(id);
  else renderHome();
}

// ====== 시드 & 홈 ======
const DEFAULT_PROGRAMS = [
  { id: "devconf", title: "개발자 컨퍼런스", emoji: "🧑‍💻" },
  { id: "ai-training", title: "AI 활용 교육", emoji: "🤖" },
  { id: "leaders", title: "직책자 대상 교육", emoji: "🏷️" },
  { id: "launch", title: "런칭 세션", emoji: "🚀" },
];

async function ensureProgramsSeeded() {
  const snap = await getDocs(collection(db, "programs"));
  if (snap.empty) {
    for (const p of DEFAULT_PROGRAMS) {
      await setDoc(doc(db, "programs", p.id), {
        title: p.title,
        emoji: p.emoji,
        createdAt: Date.now(),
      });
      await setDoc(doc(db, "programs", p.id, "meta", "summary"), {
        widgetNote: "요약 위젯 내용(예산/디자인/성과/내용 종합)",
        updatedAt: Date.now(),
      });
      for (const y of ["2021", "2022", "2023", "2024"]) {
        await setDoc(doc(db, "programs", p.id, "years", y), {
          budget: { avg: 0, details: "" },
          design: { note: "", assetLinks: [] },
          outcome: { analysis: "" },
          content: { outline: "" },
          updatedAt: Date.now(),
        });
      }
    }
  }
}

async function renderHome() {
  appEl.innerHTML = `
    <section class="container">
      <div class="toolbar">
        <h2>교육 카테고리</h2>
        <span class="small">최대 8개, 2열 카드</span>
      </div>
      <div id="cards" class="grid"></div>
      <div class="section small">로그인 후 카드 추가/수정 가능</div>
    </section>
  `;
  await ensureProgramsSeeded();
  const snap = await getDocs(collection(db, "programs"));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  const cards = document.getElementById("cards");
  cards.innerHTML = list.slice(0, 8).map((p) => `
    <article class="card" data-id="${p.id}">
      <div class="emoji">${p.emoji || "📘"}</div>
      <div class="title">${p.title || p.id}</div>
      <div class="small muted">클릭하여 이동</div>
    </article>
  `).join("");

  cards.querySelectorAll(".card").forEach((c) => {
    c.addEventListener("click", () => { location.hash = `#/program/${c.dataset.id}`; });
  });

  // 로그인 사용자만 추가 버튼 노출
  onAuthStateChanged(auth, (user) => {
    const toolbar = appEl.querySelector(".toolbar");
    const exists = document.getElementById("addProg");
    if (user && !exists) {
      const add = document.createElement("button");
      add.id = "addProg";
      add.className = "btn";
      add.textContent = "카테고리 추가";
      add.addEventListener("click", async () => {
        const id = prompt("프로그램 ID (영문/숫자/하이픈)"); if (!id) return;
        const title = prompt("표시 이름"); if (!title) return;
        const emoji = prompt("이모지 (예: 🎯)") || "📘";
        await setDoc(doc(db, "programs", id), { title, emoji, createdAt: Date.now() });
        location.reload();
      });
      toolbar.appendChild(add);
    } else if (!user && exists) {
      exists.remove();
    }
  });
}

// ====== 상세 ======
async function renderProgramPage(programId) {
  const progDoc = await getDoc(doc(db, "programs", programId));
  if (!progDoc.exists()) {
    appEl.innerHTML = `<section class="container"><p class="err">존재하지 않는 프로그램: ${programId}</p></section>`;
    return;
  }
  const prog = { id: programId, ...progDoc.data() };
  const summaryRef = doc(db, "programs", programId, "meta", "summary");
  const summarySnap = await getDoc(summaryRef);
  const summary = summarySnap.exists() ? summarySnap.data() : {};

  appEl.innerHTML = `
    <section class="container">
      <div class="toolbar">
        <a class="link" href="#/home">← 목록</a>
        <h2>${prog.emoji || "📘"} ${prog.title}</h2>
        <span class="badge">${programId}</span>
      </div>

      <section class="section">
        <h3>위젯(종합)</h3>
        <textarea id="widgetNote" placeholder="예산/디자인/성과/내용을 한눈에 요약">${summary.widgetNote || ""}</textarea>
        <div class="row">
          <button id="saveWidget" class="btn">저장</button>
          <span class="small muted">로그인 사용자만 저장 가능</span>
        </div>
      </section>

      <section class="section">
        <h3>항목별 단일 페이지</h3>
        <div class="kv"><strong>예산</strong><textarea id="budgetDetails" placeholder="평균 예산 및 지출 항목"></textarea></div>
        <div class="kv"><strong>디자인</strong>
          <div>
            <input id="designNote" placeholder="디자인 설명/비고" />
            <div class="row">
              <input type="file" id="designFile" />
              <button class="btn" id="uploadDesign">파일 업로드</button>
              <div id="designLinks" class="small"></div>
            </div>
          </div>
        </div>
        <div class="kv"><strong>교육 성과</strong><textarea id="outcomeAnalysis" placeholder="설문 데이터 분석 요약"></textarea></div>
        <div class="kv"><strong>교육 내용</strong><textarea id="contentOutline" placeholder="강의/세션 구성 요약"></textarea></div>
        <div class="row"><button id="saveItems" class="btn">저장</button></div>
      </section>

      <section class="section">
        <h3>연도별 상세</h3>
        <div class="row">
          <select id="yearSel">
            <option value="2021">2021</option>
            <option value="2022">2022</option>
            <option value="2023">2023</option>
            <option value="2024" selected>2024</option>
          </select>
          <span class="small muted">연도 선택 후 아래 항목 저장</span>
        </div>
        <div class="kv"><strong>예산</strong><textarea id="yBudget"></textarea></div>
        <div class="kv"><strong>디자인</strong><textarea id="yDesign"></textarea></div>
        <div class="kv"><strong>교육 성과</strong><textarea id="yOutcome"></textarea></div>
        <div class="kv"><strong>교육 내용</strong><textarea id="yContent"></textarea></div>
        <div class="row"><button id="saveYear" class="btn">연도별 저장</button></div>
      </section>
    </section>
  `;

  const yearSel = document.getElementById("yearSel");
  yearSel.addEventListener("change", () => loadYear(yearSel.value));
  await loadYear(yearSel.value);

  async function loadYear(y) {
    const yRef = doc(db, "programs", programId, "years", y);
    const ySnap = await getDoc(yRef);
    if (ySnap.exists()) {
      const yv = ySnap.data();
      document.getElementById("yBudget").value = yv.budget?.details || "";
      document.getElementById("yDesign").value = yv.design?.note || "";
      document.getElementById("yOutcome").value = yv.outcome?.analysis || "";
      document.getElementById("yContent").value = yv.content?.outline || "";
    }
  }

  document.getElementById("saveWidget").addEventListener("click", async () => {
    const widgetNote = document.getElementById("widgetNote").value;
    await setDoc(summaryRef, { widgetNote, updatedAt: Date.now() }, { merge: true });
    alert("저장 완료");
  });

  document.getElementById("uploadDesign").addEventListener("click", async () => {
    const file = document.getElementById("designFile").files[0];
    if (!file) return alert("파일을 선택하세요");
    const r = ref(storage, `programs/${programId}/design/${Date.now()}_${file.name}`);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);
    const box = document.getElementById("designLinks");
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.textContent = "업로드 파일 보기";
    box.appendChild(a);
    box.appendChild(document.createTextNode(" "));
  });

  document.getElementById("saveItems").addEventListener("click", async () => {
    const yRef = doc(db, "programs", programId, "years", "single");
    await setDoc(
      yRef,
      {
        budget: { details: document.getElementById("budgetDetails").value },
        design: { note: document.getElementById("designNote").value },
        outcome: { analysis: document.getElementById("outcomeAnalysis").value },
        content: { outline: document.getElementById("contentOutline").value },
        updatedAt: Date.now(),
      },
      { merge: true }
    );
    alert("저장 완료");
  });

  document.getElementById("saveYear").addEventListener("click", async () => {
    const y = yearSel.value;
    const yRef = doc(db, "programs", programId, "years", y);
    await setDoc(
      yRef,
      {
        budget: { details: document.getElementById("yBudget").value },
        design: { note: document.getElementById("yDesign").value },
        outcome: { analysis: document.getElementById("yOutcome").value },
        content: { outline: document.getElementById("yContent").value },
        updatedAt: Date.now(),
      },
      { merge: true }
    );
    alert("연도별 저장 완료");
  });
}

// 초기 진입
route();
