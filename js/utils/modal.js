// js/utils/modal.js
export function ensureModalStyle() {
  if (document.getElementById('modal-style')) return;
  const s = document.createElement('style');
  s.id = 'modal-style';
  s.textContent = `
    .om-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999}
    .om-modal{width:min(920px,95vw);max-height:85vh;overflow:auto;background:#11182b;border:1px solid #223053;border-radius:16px;box-shadow:0 24px 72px rgba(0,0,0,.5);color:#eaf1ff}
    .om-hd{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #223053}
    .om-bd{padding:16px;display:block}
    .om-ft{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #223053}
    .om-btn{border:1px solid #223053;background:#162138;color:#eaf1ff;border-radius:10px;padding:8px 12px;cursor:pointer}
    .om-btn.primary{background:#4ea3ff;color:#08142b;border-color:#4ea3ff}
  `;
  document.head.appendChild(s);
}

export function openModal({ title, contentHTML, onClose, footerHTML }) {
  ensureModalStyle();
  const overlay = document.createElement('div');
  overlay.className = 'om-overlay';
  overlay.innerHTML = `
    <div class="om-modal">
      <div class="om-hd">
        <strong>${title || ''}</strong>
        <button class="om-btn" id="omClose">닫기</button>
      </div>
      <div class="om-bd">${contentHTML || ''}</div>
      <div class="om-ft">${footerHTML || ''}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#omClose').addEventListener('click', ()=>{ overlay.remove(); onClose && onClose(); });
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay){ overlay.remove(); onClose && onClose(); }});
  return overlay;
}
