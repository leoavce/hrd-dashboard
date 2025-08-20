// js/schemaUI.js
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openModal } from "./utils/modal.js";

const WIDGET_CATALOG = [
  { key:'summary', label:'교육 내용 전반 요약' },
  { key:'budget',  label:'예산안 평균' },
  { key:'outcome', label:'교육 성과 전반 요약' },
  { key:'design',  label:'포함 디자인' }
];
const ITEM_CATALOG = [
  { key:'content', label:'교육 내용' },
  { key:'budget',  label:'교육 예산' },
  { key:'outcome', label:'교육 성과' },
  { key:'design',  label:'교육 디자인' }
];

/**
 * 스키마 편집 모달(체크박스 ON/OFF)
 * onSaved: 저장완료 콜백
 */
export async function openSchemaEditor(db, programId, currentSchema, onSaved){
  const widgetsSel = new Set(currentSchema?.sections?.widgets || []);
  const itemsSel   = new Set(currentSchema?.sections?.items   || []);

  const html = `
    <div class="schema-grid">
      <section>
        <h4>Cut #1 — 위젯(전체 요약)</h4>
        ${WIDGET_CATALOG.map(o=>`
          <label class="ck">
            <input type="checkbox" data-scope="widgets" value="${o.key}" ${widgetsSel.has(o.key)?'checked':''} />
            <span>${o.label}</span>
          </label>
        `).join('')}
      </section>
      <section>
        <h4>Cut #2 — 항목별 페이지</h4>
        ${ITEM_CATALOG.map(o=>`
          <label class="ck">
            <input type="checkbox" data-scope="items" value="${o.key}" ${itemsSel.has(o.key)?'checked':''} />
            <span>${o.label}</span>
          </label>
        `).join('')}
      </section>
    </div>
    <p class="muted" style="margin-top:8px">* 체크 해제하면 해당 카드/블록이 화면에서 숨겨집니다. (데이터는 보존)</p>
  `;

  const ov = openModal({
    title:'섹션 구성',
    contentHTML: html,
    footerHTML: `<button class="om-btn" id="cancel">취소</button>
                 <button class="om-btn primary" id="save">저장</button>`
  });

  ov.querySelector('#cancel').addEventListener('click', ()=> ov.remove());
  ov.querySelector('#save').addEventListener('click', async ()=>{
    const nextWidgets = Array.from(ov.querySelectorAll('input[data-scope="widgets"]:checked')).map(i=>i.value);
    const nextItems   = Array.from(ov.querySelectorAll('input[data-scope="items"]:checked')).map(i=>i.value);
    await setDoc(doc(db,'programs',programId,'meta','schema'), {
      sections: { widgets: nextWidgets, items: nextItems }, updatedAt: Date.now()
    }, { merge:true });
    ov.remove();
    if (typeof onSaved === 'function') onSaved();
  });

  injectStyle();
}

function injectStyle(){
  if (document.getElementById('schema-style')) return;
  const s = document.createElement('style'); s.id='schema-style';
  s.textContent = `
    .schema-grid{ display:grid; grid-template-columns:1fr 1fr; gap:18px; }
    .schema-grid h4{ margin:0 0 10px; color:#eaf1ff; }
    .schema-grid .ck{ display:flex; align-items:center; gap:10px; margin:8px 0; }
    .schema-grid input[type="checkbox"]{ width:18px; height:18px; }
    @media(max-width:720px){ .schema-grid{ grid-template-columns:1fr; } }
  `;
  document.head.appendChild(s);
}
