// js/ongoingDashboard.js
import {
  collection, getDocs, doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openModal } from "./utils/modal.js";

/**
 * 홈 상단 "진행/준비중인 교육" 패널 초기화
 * - 프로그램 목록 불러오고, 각 프로그램의 meta/ongoing.items[]를 합쳐서 렌더
 * - 데이터 스키마:
 *   programs/{programId}/meta/ongoing => { items: [ { id, title, from, to, checklist:[{id,text,done}] } ] }
 */
export async function initHomeDashboard(db){
  const host = document.getElementById("homeDashboard");
  if(!host) return;

  // 데이터 로드
  const programsSnap = await getDocs(collection(db, "programs"));
  const programs = [];
  programsSnap.forEach(d => programs.push({ id:d.id, ...d.data() }));

  const allItems = [];
  for (const p of programs){
    const mref = doc(db, "programs", p.id, "meta", "ongoing");
    const msnap = await getDoc(mref);
    const items = msnap.exists() ? (msnap.data()?.items || []) : [];
    items.forEach(it => allItems.push({
      ...it,
      programId: p.id,
      programTitle: p.title || p.id,
      emoji: p.emoji || "📘"
    }));
  }

  // 렌더
  host.innerHTML = `
    <div class="panel">
      <div class="panel-hd">
        <h4>진행/준비중인 교육</h4>
        <div class="row">
          <button class="btn small ghost" id="odEdit">편집</button>
          <button class="btn small" id="odAdd" style="display:none">추가</button>
        </div>
      </div>
      <div class="chips" id="odChips">
        ${allItems.length ? allItems.map(chipHTML).join("") : `
          <div class="empty">등록된 진행/준비중 교육이 없습니다.</div>
        `}
      </div>
    </div>
  `;

  let edit = false;
  const btnEdit = host.querySelector("#odEdit");
  const btnAdd  = host.querySelector("#odAdd");
  const chips   = host.querySelector("#odChips");

  btnEdit.addEventListener("click", ()=>{
    edit = !edit;
    btnEdit.textContent = edit ? "편집 종료" : "편집";
    btnAdd.style.display = edit ? "" : "none";
    chips.querySelectorAll(".chip .chip-del").forEach(x => x.style.display = edit ? "" : "none");
  });

  btnAdd.addEventListener("click", async ()=>{
    // 어떤 프로그램의 진행 건인지 선택 → 기본 값 생성
    const prog = await pickProgram(programs);
    if(!prog) return;

    const payload = {
      id: crypto.randomUUID(),
      title: prog.title || "새 교육",
      from: new Date().toISOString().slice(0,10),
      to:   new Date().toISOString().slice(0,10),
      checklist: [
        { id: crypto.randomUUID(), text: "장소 확정",  done:false },
        { id: crypto.randomUUID(), text: "강사 섭외",  done:false },
        { id: crypto.randomUUID(), text: "디자인 확정", done:false },
      ]
    };
    await upsertOngoing(db, prog.id, payload, "add");
    // 칩 다시 그림
    initHomeDashboard(db);
  });

  // 칩 인터랙션
  chips.querySelectorAll(".chip").forEach(chip=>{
    chip.addEventListener("click", (e)=>{
      // 휴지통 클릭이면 삭제
      if (e.target.closest(".chip-del")){
        if(!confirm("이 항목을 삭제할까요?")) return;
        const { programId, itemId } = chip.dataset;
        removeOngoing(db, programId, itemId).then(()=> initHomeDashboard(db));
        return;
      }
      // 상세 모달
      const data = JSON.parse(chip.dataset.payload);
      openDetailModal(db, data).then(saved=>{
        if(saved) initHomeDashboard(db);
      });
    });
  });
}

/* ---------- HTML ---------- */
function chipHTML(it){
  const period = it.from && it.to ? `${it.from} ~ ${it.to}` : "";
  return `
    <div class="chip" data-program-id="${it.programId}" data-item-id="${it.id}"
         data-payload='${JSON.stringify(it).replace(/'/g,"&#39;")}'>
      <div class="l">
        <span class="emoji">${it.emoji || "📘"}</span>
        <span class="title">${escapeHtml(it.title)}</span>
        <span class="period">${period}</span>
      </div>
      <button class="chip-del" title="삭제" style="display:none">🗑</button>
    </div>
  `;
}

/* ---------- 상세 모달 ---------- */
async function openDetailModal(db, data){
  return new Promise(resolve=>{
    const ckList = data.checklist?.map(ck => lineHTML(ck)).join("") || "";
    const content = `
      <div class="od-detail">
        <div class="od-row">
          <label>교육명</label>
          <input id="odTitle" value="${escapeHtml(data.title||"")}" />
        </div>
        <div class="od-row two">
          <div>
            <label>시작일</label>
            <input id="odFrom" type="date" value="${data.from||""}">
          </div>
          <div>
            <label>종료일</label>
            <input id="odTo" type="date" value="${data.to||""}">
          </div>
        </div>

        <div class="od-row">
          <div class="od-subhd">체크리스트</div>
          <div id="ckBox" class="ck-list">
            ${ckList || '<div class="muted">항목이 없습니다.</div>'}
          </div>
          <div class="ck-add">
            <input id="ckNew" placeholder="항목 추가" />
            <button class="om-btn" id="ckAddBtn">추가</button>
          </div>
        </div>
      </div>
    `;

    const ov = openModal({
      title: `${data.emoji||"📘"} ${escapeHtml(data.programTitle||"")}`,
      contentHTML: content,
      footerHTML: `
        <button class="om-btn" id="close">닫기</button>
        <button class="om-btn primary" id="save">저장</button>`
    });

    // 체크 토글/삭제
    const ckBox = ov.querySelector("#ckBox");
    ckBox.addEventListener("click", (e)=>{
      const row = e.target.closest(".ck-row");
      if(!row) return;
      const id = row.dataset.id;

      // 삭제
      if (e.target.closest(".ck-del")){
        row.remove();
        return;
      }
      // 토글
      if (e.target.closest(".ck-box") || e.target.classList.contains("ck-text")){
        row.classList.toggle("done");
      }
    });

    // 추가
    ov.querySelector("#ckAddBtn").addEventListener("click", ()=>{
      const input = ov.querySelector("#ckNew");
      const text = (input.value||"").trim();
      if(!text) return;
      input.value = "";
      ckBox.insertAdjacentHTML("beforeend", lineHTML({ id: crypto.randomUUID(), text, done:false }));
    });

    ov.querySelector("#close").addEventListener("click", ()=>{ ov.remove(); resolve(false); });
    ov.querySelector("#save").addEventListener("click", async ()=>{
      // 수집/저장
      const title = ov.querySelector("#odTitle").value.trim();
      const from  = ov.querySelector("#odFrom").value || "";
      const to    = ov.querySelector("#odTo").value   || "";

      const checklist = Array.from(ov.querySelectorAll(".ck-row")).map(row => ({
        id: row.dataset.id,
        text: row.querySelector(".ck-text").textContent.trim(),
        done: row.classList.contains("done")
      }));

      const payload = { ...data, title, from, to, checklist };
      await upsertOngoing(db, data.programId, payload, "update");
      ov.remove();
      resolve(true);
    });
  });
}

function lineHTML(ck){
  return `
    <div class="ck-row ${ck.done?'done':''}" data-id="${ck.id}">
      <span class="ck-box" aria-hidden="true"></span>
      <span class="ck-text" contenteditable="true">${escapeHtml(ck.text||"")}</span>
      <button class="ck-del" title="삭제">🗑</button>
    </div>
  `;
}

/* ---------- 데이터 IO ---------- */
async function upsertOngoing(db, programId, item, mode){
  const mref = doc(db, "programs", programId, "meta", "ongoing");
  const msnap = await getDoc(mref);
  const items = msnap.exists() ? (msnap.data()?.items || []) : [];

  const idx = items.findIndex(x => x.id === item.id);
  if (mode === "add" && idx === -1){
    items.push(item);
  } else if (mode === "update" && idx > -1){
    items[idx] = item;
  } else if (mode === "update" && idx === -1){
    items.push(item);
  }
  await setDoc(mref, { items, updatedAt: Date.now() }, { merge:true });
}

async function removeOngoing(db, programId, itemId){
  const mref = doc(db, "programs", programId, "meta", "ongoing");
  const msnap = await getDoc(mref);
  const items = msnap.exists() ? (msnap.data()?.items || []) : [];
  const filtered = items.filter(x => x.id !== itemId);
  await setDoc(mref, { items: filtered, updatedAt: Date.now() }, { merge:true });
}

/* ---------- 보조 ---------- */
function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m])); }

/** 프로그램 선택 미니 모달 */
async function pickProgram(programs){
  return new Promise(resolve=>{
    const listHTML = programs.map(p=>`
      <button class="om-btn pick-prog" data-id="${p.id}" data-title="${escapeHtml(p.title||p.id)}" data-emoji="${p.emoji||"📘"}">
        ${p.emoji||"📘"} ${escapeHtml(p.title||p.id)}
      </button>
    `).join("");
    const ov = openModal({
      title: "어느 프로그램에 추가할까요?",
      contentHTML: `<div class="pick-grid">${listHTML}</div>`,
      footerHTML: `<button class="om-btn" id="cancel">취소</button>`
    });
    ov.querySelector("#cancel").addEventListener("click", ()=>{ ov.remove(); resolve(null); });
    ov.querySelectorAll(".pick-prog").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        ov.remove();
        resolve({ id: btn.dataset.id, title: btn.dataset.title, emoji: btn.dataset.emoji });
      });
    });
    // 스타일 주입
    if(!document.getElementById("pick-style")){
      const s=document.createElement("style"); s.id="pick-style";
      s.textContent=`
        .pick-grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        @media(max-width:680px){ .pick-grid{ grid-template-columns:1fr; } }
      `;
      document.head.appendChild(s);
    }
  });
}
