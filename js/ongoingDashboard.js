// js/ongoingDashboard.js
import {
  collection, getDocs, doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openModal } from "./utils/modal.js";

/**
 * 홈 상단 "진행/준비중인 교육" 패널
 * meta/ongoing.items[] 스키마:
 * { id, title, from, to, checklist:[{id,text,done}] }
 */
export async function initHomeDashboard(db){
  const host = document.getElementById("homeDashboard");
  if(!host) return;

  // 프로그램 목록
  const pSnap = await getDocs(collection(db, "programs"));
  const programs = [];
  pSnap.forEach(d => programs.push({ id: d.id, ...d.data() }));

  // 진행/준비중 항목 수집
  const all = [];
  for (const p of programs){
    const mref = doc(db, "programs", p.id, "meta", "ongoing");
    const ms   = await getDoc(mref);
    const items = ms.exists() ? (ms.data()?.items || []) : [];
    items.forEach(it => all.push({
      ...it,
      programId: p.id,
      programTitle: p.title || p.id,
      emoji: p.emoji || "📘",
    }));
  }

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
        ${all.length ? all.map(chipHTML).join("") : `<div class="empty">등록된 진행/준비중 교육이 없습니다.</div>`}
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
        { id: crypto.randomUUID(), text: "디자인 확정", done:false }
      ]
    };
    await upsert(db, prog.id, payload, "add");
    initHomeDashboard(db);
  });

  // 칩 인터랙션
  chips.querySelectorAll(".chip").forEach(chip=>{
    chip.addEventListener("click", (e)=>{
      if (e.target.closest(".chip-del")){
        if(!confirm("이 항목을 삭제할까요?")) return;
        const { programId, itemId } = chip.dataset;
        removeItem(db, programId, itemId).then(()=> initHomeDashboard(db));
        return;
      }
      const data = JSON.parse(chip.dataset.payload);
      openDetailModal(db, data, { editable: edit }).then(updated=>{
        // updated가 truthy이면 최신 데이터가 반환됨 → 칩 즉시 갱신(재오픈시 체크 유지)
        if(updated){
          chip.dataset.payload = JSON.stringify(updated).replace(/'/g,"&#39;");
          chip.querySelector('.title')?.replaceWith(Object.assign(document.createElement('span'),{className:'title',textContent:updated.title||''}));
          const period = (updated.from && updated.to) ? `${updated.from} ~ ${updated.to}` : "";
          chip.querySelector('.period')?.replaceWith(Object.assign(document.createElement('span'),{className:'period',textContent:period}));
        }
      });
    });
  });
}

/* ---------- HTML ---------- */
function chipHTML(it){
  const period = (it.from && it.to) ? `${it.from} ~ ${it.to}` : "";
  const payload = JSON.stringify(it).replace(/'/g,"&#39;");
  return `
    <div class="chip" data-program-id="${it.programId}" data-item-id="${it.id}"
         data-payload='${payload}'>
      <div class="l">
        <span class="emoji">${it.emoji || "📘"}</span>
        <span class="title">${esc(it.title)}</span>
        <span class="period">${period}</span>
      </div>
      <button class="chip-del" title="삭제" style="display:none">🗑</button>
    </div>
  `;
}

/* ---------- 상세 모달 ---------- */
async function openDetailModal(db, data, { editable }){
  return new Promise(resolve=>{
    let latest = structuredClone(data); // 최신 상태를 모아 반환
    const ckHTML = (data.checklist || []).map(ck => lineHTML(ck, editable)).join("") || "";
    const content = `
      <div class="od-detail">
        <div class="od-row">
          <label>교육명</label>
          <input id="odTitle" value="${esc(data.title||"")}" ${editable ? "" : "readonly"}>
        </div>
        <div class="od-row two">
          <div>
            <label>시작일</label>
            <input id="odFrom" type="date" value="${data.from||""}" ${editable ? "" : "disabled"}>
          </div>
          <div>
            <label>종료일</label>
            <input id="odTo" type="date" value="${data.to||""}" ${editable ? "" : "disabled"}>
          </div>
        </div>

        <div class="od-row">
          <div class="od-subhd">체크리스트</div>
          <div id="ckBox" class="ck-list">
            ${ckHTML || '<div class="muted">항목이 없습니다.</div>'}
          </div>

          ${editable ? `
          <div class="ck-add">
            <input id="ckNew" placeholder="항목 추가" />
            <button class="om-btn" id="ckAddBtn">추가</button>
          </div>` : ``}
        </div>
      </div>
    `;

    const ov = openModal({
      title: `${data.emoji || "📘"} ${esc(data.programTitle || "")}`,
      contentHTML: content,
      footerHTML: editable
        ? `<button class="om-btn" id="close">닫기</button>
           <button class="om-btn primary" id="save">저장</button>`
        : `<button class="om-btn primary" id="close">닫기</button>`
    });

    // 체크박스 토글 → 항상 허용 + 즉시 저장 + 최신 상태 캐시에 반영
    const ckBox = ov.querySelector("#ckBox");
    ckBox.addEventListener("change", async (e)=>{
      const row = e.target.closest(".ck-row"); if(!row) return;
      if(!e.target.classList.contains("ck-check")) return;
      row.classList.toggle("done", e.target.checked);

      const checklist = collectChecklist(ov);
      latest = { ...latest, checklist };
      await upsert(db, data.programId, latest, "update"); // 영속화
    });

    // 텍스트 편집/삭제/추가는 편집 모드에서만
    if (editable){
      ckBox.addEventListener("click", (e)=>{
        const row = e.target.closest(".ck-row"); if(!row) return;
        if (e.target.closest(".ck-del")){ row.remove(); return; }
      });
      ov.querySelector("#ckAddBtn")?.addEventListener("click", ()=>{
        const input = ov.querySelector("#ckNew");
        const text = (input.value||"").trim();
        if(!text) return;
        input.value = "";
        ckBox.insertAdjacentHTML(
          "beforeend",
          lineHTML({ id: crypto.randomUUID(), text, done:false }, true)
        );
      });
    }else{
      ckBox.querySelectorAll(".ck-text").forEach(el=> el.setAttribute("contenteditable","false"));
    }

    ov.querySelector("#close").addEventListener("click", ()=>{ ov.remove(); resolve(latest); });
    ov.querySelector("#save")?.addEventListener("click", async ()=>{
      const title = ov.querySelector("#odTitle").value.trim();
      const from  = ov.querySelector("#odFrom").value || "";
      const to    = ov.querySelector("#odTo").value   || "";
      const checklist = collectChecklist(ov);
      latest = { ...latest, title, from, to, checklist };
      await upsert(db, data.programId, latest, "update");
      ov.remove(); resolve(latest);
    });
  });
}

function lineHTML(ck, editable){
  return `
    <label class="ck-row ${ck.done ? 'done' : ''}" data-id="${ck.id}">
      <input type="checkbox" class="ck-check" ${ck.done ? 'checked' : ''} />
      <span class="ck-text" ${editable ? 'contenteditable="true"' : ''}>${esc(ck.text||"")}</span>
      ${editable ? `<button class="ck-del" title="삭제">🗑</button>` : ``}
    </label>
  `;
}
function collectChecklist(ov){
  return Array.from(ov.querySelectorAll(".ck-row")).map(row => ({
    id:   row.dataset.id,
    text: row.querySelector(".ck-text").textContent.trim(),
    done: row.querySelector(".ck-check").checked
  }));
}

/* ---------- 데이터 IO ---------- */
async function upsert(db, programId, item, mode){
  const mref = doc(db, "programs", programId, "meta", "ongoing");
  const msnap = await getDoc(mref);
  const items = msnap.exists() ? (msnap.data()?.items || []) : [];
  const idx = items.findIndex(x => x.id === item.id);

  if (mode === "add" && idx === -1) items.push(item);
  else if (mode === "update" && idx > -1) items[idx] = item;
  else if (mode === "update" && idx === -1) items.push(item);

  await setDoc(mref, { items, updatedAt: Date.now() }, { merge:true });
}
async function removeItem(db, programId, itemId){
  const mref = doc(db, "programs", programId, "meta", "ongoing");
  const msnap = await getDoc(mref);
  const items = msnap.exists() ? (msnap.data()?.items || []) : [];
  const filtered = items.filter(x => x.id !== itemId);
  await setDoc(mref, { items: filtered, updatedAt: Date.now() }, { merge:true });
}

/* ---------- 보조 ---------- */
function esc(s){
  return String(s||"").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"
  }[m]));
}

async function pickProgram(programs){
  return new Promise(resolve=>{
    const listHTML = programs.map(p=>`
      <button class="om-btn pick-prog" data-id="${p.id}" data-title="${esc(p.title||p.id)}" data-emoji="${p.emoji||"📘"}">
        ${p.emoji||"📘"} ${esc(p.title||p.id)}
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
    if(!document.getElementById("pick-style")){
      const s = document.createElement("style"); s.id = "pick-style";
      s.textContent = `
        .pick-grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        @media(max-width:680px){ .pick-grid{ grid-template-columns:1fr; } }
      `;
      document.head.appendChild(s);
    }
  });
}
