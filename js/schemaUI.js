// js/schemaUI.js
import { SECTION_DEFS, getProgramSchema, setProgramSchema } from "./programSchema.js";

/**
 * 스키마 편집 모달 열기
 * @param {*} db           Firestore 인스턴스
 * @param {string} pid     programId
 * @param {Function} onSaved 저장 후 콜백(예: 상세 페이지 재렌더)
 */
export async function openSchemaEditor(db, pid, onSaved) {
  const current = await getProgramSchema(db, pid); // { sections: [...] }
  const allIds = Object.keys(SECTION_DEFS);

  // 스타일 주입(1회)
  if (!document.getElementById("schema-ui-style")) {
    const style = document.createElement("style");
    style.id = "schema-ui-style";
    style.textContent = `
    .schema-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:9999}
    .schema-modal{width:min(680px,92vw);background:#11182b;border:1px solid #223053;border-radius:16px;color:#eaf1ff;box-shadow:0 20px 60px rgba(0,0,0,.5)}
    .schema-hd{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #223053}
    .schema-bd{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px 16px}
    .schema-col{background:#0e1629;border:1px solid #223053;border-radius:12px;padding:12px}
    .schema-col h4{margin:0 0 8px 0;font-size:14px;color:#8aa0c3}
    .schema-list{display:flex;flex-direction:column;gap:8px;max-height:300px;overflow:auto}
    .schema-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px;border:1px solid #223053;border-radius:10px;background:#0b1426}
    .schema-actions{display:flex;gap:6px}
    .schema-actions button{border:1px solid #223053;background:#162138;color:#eaf1ff;border-radius:8px;padding:4px 8px;cursor:pointer}
    .schema-ft{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #223053}
    .schema-btn{border:none;background:#4ea3ff;color:#08142b;padding:8px 12px;border-radius:10px;cursor:pointer;font-weight:700}
    .schema-btn.ghost{background:transparent;color:#eaf1ff;border:1px solid #223053}
    label.schema-check{display:flex;align-items:center;gap:8px}
    `;
    document.head.appendChild(style);
  }

  // DOM 생성
  const overlay = document.createElement("div");
  overlay.className = "schema-overlay";
  overlay.innerHTML = `
    <div class="schema-modal">
      <div class="schema-hd">
        <strong>섹션 구성</strong>
        <button id="schemaClose" class="schema-btn ghost">닫기</button>
      </div>
      <div class="schema-bd">
        <div class="schema-col">
          <h4>사용할 섹션 선택</h4>
          <div class="schema-list" id="schemaAll"></div>
        </div>
        <div class="schema-col">
          <h4>표시 순서</h4>
          <div class="schema-list" id="schemaSelected"></div>
        </div>
      </div>
      <div class="schema-ft">
        <button id="schemaSave" class="schema-btn">저장</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // 렌더 함수
  function renderAll() {
    const host = document.getElementById("schemaAll");
    host.innerHTML = "";
    allIds.forEach(id => {
      const row = document.createElement("div");
      row.className = "schema-item";
      const checked = current.sections.includes(id);
      row.innerHTML = `
        <label class="schema-check">
          <input type="checkbox" data-id="${id}" ${checked ? "checked" : ""}/>
          ${SECTION_DEFS[id].title}
        </label>
        <div class="schema-actions">
          <button data-act="add" data-id="${id}">추가</button>
          <button data-act="remove" data-id="${id}">제거</button>
        </div>
      `;
      host.appendChild(row);
    });
  }

  function renderSelected() {
    const host = document.getElementById("schemaSelected");
    host.innerHTML = "";
    current.sections.forEach((id, idx) => {
      const row = document.createElement("div");
      row.className = "schema-item";
      row.innerHTML = `
        <div>${SECTION_DEFS[id]?.title || id}</div>
        <div class="schema-actions">
          <button data-act="up" data-idx="${idx}">▲</button>
          <button data-act="down" data-idx="${idx}">▼</button>
          <button data-act="removeAt" data-idx="${idx}">삭제</button>
        </div>
      `;
      host.appendChild(row);
    });
  }

  renderAll();
  renderSelected();

  // 이벤트: 좌측 체크/추가/제거
  document.getElementById("schemaAll").addEventListener("click", (e) => {
    const t = e.target;
    const id = t.dataset.id;
    if (!id) return;
    if (t.dataset.act === "add") {
      if (!current.sections.includes(id)) current.sections.push(id);
      renderAll(); renderSelected();
    }
    if (t.dataset.act === "remove") {
      current.sections = current.sections.filter(s => s !== id);
      renderAll(); renderSelected();
    }
  });

  document.getElementById("schemaAll").addEventListener("change", (e) => {
    const t = e.target;
    if (t.tagName !== "INPUT") return;
    const id = t.dataset.id;
    if (t.checked) {
      if (!current.sections.includes(id)) current.sections.push(id);
    } else {
      current.sections = current.sections.filter(s => s !== id);
    }
    renderAll(); renderSelected();
  });

  // 이벤트: 우측 순서/삭제
  document.getElementById("schemaSelected").addEventListener("click", (e) => {
    const t = e.target;
    const idx = Number(t.dataset.idx);
    if (Number.isNaN(idx)) return;
    if (t.dataset.act === "up" && idx > 0) {
      [current.sections[idx-1], current.sections[idx]] = [current.sections[idx], current.sections[idx-1]];
    }
    if (t.dataset.act === "down" && idx < current.sections.length - 1) {
      [current.sections[idx+1], current.sections[idx]] = [current.sections[idx], current.sections[idx+1]];
    }
    if (t.dataset.act === "removeAt") {
      current.sections.splice(idx, 1);
    }
    renderAll(); renderSelected();
  });

  // 저장/닫기
  document.getElementById("schemaSave").addEventListener("click", async ()=>{
    await setProgramSchema(db, pid, current.sections);
    overlay.remove();
    if (typeof onSaved === "function") onSaved(current.sections);
  });
  document.getElementById("schemaClose").addEventListener("click", ()=> overlay.remove());
}
