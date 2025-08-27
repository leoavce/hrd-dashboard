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
  ensureStyle();

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
    <div class="panel od-panel">
      <div class="panel-hd od-hd">
        <h4 class="od-title">진행/준비중인 교육</h4>
        <div class="panel-actions">
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
          <div class="od-subhd">
            체크리스트
            ${editable ? `<span class="od-subhint">항목 더블클릭 또는 연필 아이콘으로 편집</span>` : ``}
          </div>

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

    // 편집 모드: 삭제/추가/텍스트편집
    if (editable){
      // 삭제
      ckBox.addEventListener("click", (e)=>{
        const row = e.target.closest(".ck-row"); if(!row) return;
        if (e.target.closest(".ck-del")){ row.remove(); return; }
        if (e.target.closest(".ck-edit")){
          const textEl = row.querySelector(".ck-text");
          textEl.setAttribute("contenteditable","true");
          textEl.focus();
          // 커서 맨뒤
          const range = document.createRange(); const sel = window.getSelection();
          range.selectNodeContents(textEl); range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
        }
      });
      // 더블클릭으로도 편집
      ckBox.addEventListener("dblclick", (e)=>{
        const row = e.target.closest(".ck-row"); if(!row) return;
        const textEl = row.querySelector(".ck-text");
        textEl.setAttribute("contenteditable","true");
        textEl.focus();
      });
      // 엔터 시 편집 종료
      ckBox.addEventListener("keydown", (e)=>{
        if (e.key === "Enter" && e.target.classList.contains("ck-text")){
          e.preventDefault();
          e.target.blur();
        }
      });
      ckBox.addEventListener("blur", (e)=>{
        if (e.target.classList.contains("ck-text")){
          e.target.removeAttribute("contenteditable");
        }
      }, true);

      // 항목 추가
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
      // 읽기 모드에선 contenteditable 금지
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
  // label을 사용해 체크박스/텍스트 정렬 + 접근성
  return `
    <label class="ck-row ${ck.done ? 'done' : ''}" data-id="${ck.id}">
      <input type="checkbox" class="ck-check" ${ck.done ? 'checked' : ''} />
      <span class="ck-text" ${editable ? '' : 'contenteditable="false"'}>${esc(ck.text||"")}</span>
      ${editable ? `
        <div class="ck-actions">
          <button type="button" class="ck-edit" title="편집">✎</button>
          <button type="button" class="ck-del"  title="삭제">🗑</button>
        </div>` : ``}
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

/* ---------- 스타일 주입 ---------- */
function ensureStyle(){
  if (document.getElementById("od-style")) return;
  const s = document.createElement("style"); s.id = "od-style";
  s.textContent = `
  /* 헤더: 우측 상단 정렬 */
  .od-panel .od-hd{
    display:flex; align-items:center; justify-content:space-between;
    gap: 12px; margin-bottom: 8px;
  }
  .od-panel .od-title{ margin:0; }
  .od-panel .panel-actions{ display:flex; align-items:center; gap:8px; margin-left:auto; }

  /* 칩 기본(기존 디자인 유지 가정) */
  .od-panel .chips .chip{
    display:flex; align-items:center; justify-content:space-between;
    padding:10px 12px; border:1px solid var(--line); border-radius:10px;
    background:#0f1b22; color:#eaf2ff; gap:12px;
  }
  .od-panel .chips .chip .l{ display:flex; align-items:center; gap:8px; min-width:0 }
  .od-panel .chips .chip .title{ font-weight:700; }
  .od-panel .chips .chip .period{ color:#9fb4c8; font-size:.9rem; }
  .od-panel .chips .chip .chip-del{ background:none; border:0; cursor:pointer; color:#ff8b8b; font-size:1rem; }

  /* 상세 모달 폼 */
  .od-detail .od-row{ margin:10px 0; }
  .od-detail .od-row.two{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .od-detail label{ display:block; color:#bcd3f0; font-size:.92rem; margin-bottom:4px; }
  .od-detail input[type="text"], .od-detail input[type="date"], .od-detail input:not([type]){
    width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:#0f1b22; color:#eaf2ff;
  }
  .od-subhd{ font-weight:700; color:#eaf2ff; display:flex; align-items:center; gap:8px; }
  .od-subhd .od-subhint{ color:#94abc7; font-weight:400; font-size:.85rem; }

  /* 체크리스트 */
  .ck-list{ display:flex; flex-direction:column; gap:8px; margin-top:8px; }
  .ck-row{
    display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:10px;
    padding:10px 12px; border:1px solid var(--line); background:#0c1522; border-radius:10px;
  }
  .ck-row:hover{ background:#0f1b2b; }
  .ck-row input.ck-check{ width:18px; height:18px; }
  .ck-row .ck-text{
    min-height:18px; line-height:1.4; outline:none; word-break:break-word;
    color:#eaf2ff;
  }
  .ck-row.done .ck-text{ color:#9fb4c8; text-decoration:line-through; }
  .ck-actions{ display:flex; gap:6px; }
  .ck-actions .ck-edit, .ck-actions .ck-del{
    background:#0f1b22; border:1px solid var(--line); color:#eaf2ff;
    border-radius:8px; padding:4px 6px; cursor:pointer;
  }
  .ck-actions .ck-del{ color:#ff9090; }
  .ck-actions .ck-edit:hover, .ck-actions .ck-del:hover{ background:#132235; }

  .ck-add{ display:flex; gap:8px; margin-top:10px; }
  .ck-add input{ flex:1; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:#0f1b22; color:#eaf2ff; }
  `;
  document.head.appendChild(s);
}
