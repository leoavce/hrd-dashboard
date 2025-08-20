// js/ongoingDashboard.js
import {
  collection, getDocs, addDoc, doc, getDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * 홈 상단 "진행/준비중 교육" 대시보드 초기화
 * - 컨테이너: #homeDashboard
 * - 데이터: Firestore collection 'ongoings'
 * - 기능:
 *   - 목록: 제목/기간 노출, 클릭 시 체크리스트 모달
 *   - 편집 토글: 항목 추가/제거/제목·기간 수정, 교육 삭제
 *   - 체크리스트: 체크/해제 즉시 저장(편집 모드와 무관), 항목 추가/삭제는 편집 모드에서만
 */
export function initHomeDashboard(db) {
  const host = document.getElementById("homeDashboard");
  if (!host) return;

  // 스타일 1회 주입
  if (!document.getElementById("od-style")) {
    const css = document.createElement("style");
    css.id = "od-style";
    css.textContent = `
      .od-wrap{background:#0e1629;border:1px solid #223053;border-radius:16px;padding:14px}
      .od-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
      .od-title{font-size:16px;color:#eaf1ff;font-weight:700}
      .od-btn{border:1px solid #223053;background:#162138;color:#eaf1ff;border-radius:10px;padding:6px 10px;cursor:pointer}
      .od-btn.primary{background:#4ea3ff;color:#08142b;border-color:#4ea3ff}
      .od-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
      .od-card{background:#0b1426;border:1px solid #223053;border-radius:12px;padding:12px;cursor:pointer}
      .od-card:hover{border-color:#35518a}
      .od-name{font-weight:700;margin-bottom:4px;color:#eaf1ff}
      .od-date{font-size:12px;color:#9bb0cf}
      .od-badges{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}
      .od-badge{font-size:11px;border:1px solid #223053;border-radius:999px;padding:2px 8px;color:#9bb0cf}

      /* 모달 */
      .od-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);z-index:9999}
      .od-modal{width:min(760px,94vw);background:#11182b;border:1px solid #223053;border-radius:16px;box-shadow:0 24px 72px rgba(0,0,0,.5);color:#eaf1ff}
      .od-hd{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #223053}
      .od-hd .left{display:flex;gap:10px;align-items:center}
      .od-hd input[type="text"], .od-hd input[type="date"]{background:#0b1426;border:1px solid #223053;color:#eaf1ff;border-radius:8px;padding:6px 8px}
      .od-bd{display:grid;grid-template-columns:1fr;gap:10px;padding:14px 16px;max-height:70vh;overflow:auto}
      .od-checklist{display:flex;flex-direction:column;gap:8px}
      .od-item{display:flex;align-items:center;gap:8px;background:#0b1426;border:1px solid #223053;border-radius:10px;padding:8px}
      .od-item input[type="text"]{flex:1;background:#0e1629;border:1px solid #223053;color:#eaf1ff;border-radius:8px;padding:6px 8px}
      .od-item.done{opacity:.8}
      .od-ft{display:flex;justify-content:space-between;gap:8px;padding:12px 16px;border-top:1px solid #223053}
      .od-ft .left, .od-ft .right{display:flex;gap:8px}
      .hidden{display:none !important}
    `;
    document.head.appendChild(css);
  }

  let editMode = false;
  let list = [];

  host.innerHTML = `
    <div class="od-wrap">
      <div class="od-top">
        <div class="od-title">진행/준비중인 교육</div>
        <div>
          <button id="odToggleEdit" class="od-btn">편집</button>
          <button id="odAdd" class="od-btn primary hidden">추가</button>
        </div>
      </div>
      <div id="odList" class="od-grid"></div>
    </div>
  `;

  document.getElementById('odToggleEdit').addEventListener('click', ()=>{
    editMode = !editMode;
    document.getElementById('odToggleEdit').textContent = editMode ? '편집 종료' : '편집';
    document.getElementById('odAdd').classList.toggle('hidden', !editMode);
  });

  document.getElementById('odAdd').addEventListener('click', async ()=>{
    const title = prompt('교육명'); if(!title) return;
    const start = prompt('시작일 (YYYY-MM-DD)') || '';
    const end   = prompt('종료일 (YYYY-MM-DD)') || '';
    await addDoc(collection(db,'ongoings'), {
      title, startDate: start, endDate: end,
      checklist: [],
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    await load();
  });

  async function load(){
    const q = query(collection(db,'ongoings'), orderBy('startDate','asc'));
    const snap = await getDocs(q);
    list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    renderList();
  }

  function renderList(){
    const grid = document.getElementById('odList');
    if (!list.length) {
      grid.innerHTML = `<div class="od-card" style="opacity:.8;cursor:default">등록된 진행/준비중 교육이 없습니다.</div>`;
      return;
    }
    grid.innerHTML = list.map(item => {
      const period = (item.startDate||'') + (item.endDate ? ` ~ ${item.endDate}` : '');
      const doneCnt = (item.checklist || []).filter(i=>i.done).length;
      const total = (item.checklist || []).length;
      return `
        <article class="od-card" data-id="${item.id}">
          <div class="od-name">${item.title || '(제목 없음)'}</div>
          <div class="od-date">${period || '기간 미정'}</div>
          <div class="od-badges">
            <span class="od-badge">${total ? `체크리스트 ${doneCnt}/${total}` : '체크리스트 없음'}</span>
          </div>
        </article>
      `;
    }).join('');

    grid.querySelectorAll('.od-card').forEach(el=>{
      el.addEventListener('click', ()=> openChecklistModal(el.dataset.id));
    });
  }

  async function openChecklistModal(id){
    const ref = doc(db,'ongoings', id);
    const snap = await getDoc(ref);
    if(!snap.exists()) return;
    let data = snap.data();

    const overlay = document.createElement('div');
    overlay.className = 'od-overlay';
    overlay.innerHTML = `
      <div class="od-modal">
        <div class="od-hd">
          <div class="left">
            <input id="odTitle" type="text" value="${data.title || ''}" ${editMode? '' : 'disabled'} />
            <input id="odStart" type="date" value="${data.startDate || ''}" ${editMode? '' : 'disabled'} />
            <input id="odEnd" type="date" value="${data.endDate || ''}" ${editMode? '' : 'disabled'} />
          </div>
          <div class="right">
            <button id="odClose" class="od-btn">닫기</button>
          </div>
        </div>
        <div class="od-bd">
          <div class="od-checklist" id="odChecklist"></div>
          <div class="row" id="odAddRow" ${editMode? '' : 'style="display:none"'}>
            <div class="od-item" style="border-style:dashed">
              <input id="odNewText" type="text" placeholder="체크 항목 추가..." />
              <button id="odAddItem" class="od-btn primary">추가</button>
            </div>
          </div>
        </div>
        <div class="od-ft">
          <div class="left">
            <button id="odDelete" class="od-btn ${editMode? '' : 'hidden'}">교육 삭제</button>
          </div>
          <div class="right">
            <button id="odSave" class="od-btn primary ${editMode? '' : 'hidden'}">변경사항 저장</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const checklistEl = overlay.querySelector('#odChecklist');

    function paintChecklist(){
      const arr = data.checklist || [];
      checklistEl.innerHTML = arr.map((it, idx)=>`
        <div class="od-item ${it.done ? 'done' : ''}" data-idx="${idx}">
          <input type="checkbox" class="odChk" ${it.done ? 'checked' : ''} />
          ${editMode
            ? `<input type="text" class="odText" value="${escapeHtml(it.text || '')}" />`
            : `<div style="flex:1">${escapeHtml(it.text || '')}</div>`
          }
          ${editMode ? `<button class="od-btn odDel">삭제</button>` : ''}
        </div>
      `).join('');

      // 토글(편집모드 여부와 무관하게 동작)
      checklistEl.querySelectorAll('.odChk').forEach(box=>{
        box.addEventListener('change', async (e)=>{
          const idx = Number(box.closest('.od-item').dataset.idx);
          const arr = [...(data.checklist || [])];
          arr[idx] = { ...(arr[idx]||{}), done: !!e.target.checked };
          data.checklist = arr;
          await updateDoc(ref, { checklist: arr, updatedAt: serverTimestamp() });
          paintChecklist();
          // 리스트 카운트 갱신을 위해 전체 리로드
          await load();
        });
      });

      // 편집모드일 때만 텍스트/삭제 핸들러
      if (editMode) {
        checklistEl.querySelectorAll('.odText').forEach(inp=>{
          inp.addEventListener('input', (e)=>{
            const idx = Number(inp.closest('.od-item').dataset.idx);
            const arr = [...(data.checklist || [])];
            arr[idx] = { ...(arr[idx]||{}), text: e.target.value };
            data.checklist = arr;
          });
        });
        checklistEl.querySelectorAll('.odDel').forEach(btn=>{
          btn.addEventListener('click', ()=>{
            const idx = Number(btn.closest('.od-item').dataset.idx);
            const arr = [...(data.checklist || [])];
            arr.splice(idx,1);
            data.checklist = arr;
            paintChecklist();
          });
        });
      }
    }

    function escapeHtml(s){
      return (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }

    paintChecklist();

    // 편집 입력들
    const titleEl = overlay.querySelector('#odTitle');
    const startEl = overlay.querySelector('#odStart');
    const endEl   = overlay.querySelector('#odEnd');

    if (editMode) {
      titleEl.addEventListener('input', e => data.title = e.target.value);
      startEl.addEventListener('change', e => data.startDate = e.target.value);
      endEl.addEventListener('change', e => data.endDate = e.target.value);
    }

    // 항목 추가
    overlay.querySelector('#odAddItem')?.addEventListener('click', ()=>{
      const txt = overlay.querySelector('#odNewText').value.trim();
      if (!txt) return;
      const arr = [...(data.checklist || [])];
      arr.push({ text: txt, done:false, ts: Date.now() });
      data.checklist = arr;
      overlay.querySelector('#odNewText').value = '';
      paintChecklist();
    });

    // 저장 (편집 모드 유지/종료는 대시보드 버튼이 제어)
    overlay.querySelector('#odSave')?.addEventListener('click', async ()=>{
      await updateDoc(ref, {
        title: data.title || '',
        startDate: data.startDate || '',
        endDate: data.endDate || '',
        checklist: data.checklist || [],
        updatedAt: serverTimestamp()
      });
      alert('저장되었습니다.');
      await load(); // 목록 갱신
    });

    // 삭제
    overlay.querySelector('#odDelete')?.addEventListener('click', async ()=>{
      if (!confirm('이 교육을 삭제할까요?')) return;
      await deleteDoc(ref);
      overlay.remove();
      await load();
    });

    // 닫기
    overlay.querySelector('#odClose').addEventListener('click', ()=> overlay.remove());
    overlay.addEventListener('click', (e)=>{ if(e.target === overlay) overlay.remove(); });
  }

  // 최초 로드
  load();
}
