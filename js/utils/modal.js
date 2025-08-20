// js/utils/modal.js
/** 간단 모달 유틸. openModal({title, contentHTML, footerHTML}) → HTMLElement 반환 */
export function openModal({ title = '', contentHTML = '', footerHTML = '' } = {}){
  injectModalStyle();
  const wrap = document.createElement('div');
  wrap.className = 'om-wrap';
  wrap.innerHTML = `
    <div class="om-bg"></div>
    <div class="om-card">
      <div class="om-hd"><h3>${title}</h3><button class="om-x" aria-label="close">✕</button></div>
      <div class="om-bd">${contentHTML}</div>
      <div class="om-ft">${footerHTML}</div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelector('.om-bg').addEventListener('click', ()=> wrap.remove());
  wrap.querySelector('.om-x').addEventListener('click', ()=> wrap.remove());
  return wrap;
}

function injectModalStyle(){
  if (document.getElementById('om-style')) return;
  const s = document.createElement('style'); s.id='om-style';
  s.textContent = `
    .om-wrap{ position:fixed; inset:0; z-index:999; display:grid; place-items:center; }
    .om-bg{ position:absolute; inset:0; background:rgba(0,0,0,.55); backdrop-filter:saturate(1.2) blur(2px); }
    .om-card{ position:relative; width:min(920px, calc(100% - 32px)); max-height:80vh; overflow:auto;
      background:#121a26; color:#eaf1ff; border:1px solid #263349; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.5); }
    .om-hd{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:14px 16px; border-bottom:1px solid #263349; }
    .om-hd h3{ margin:0; font-weight:800; }
    .om-x{ background:#111a28; color:#eaf1ff; border:1px solid #28364c; border-radius:10px; padding:6px 10px; cursor:pointer; }
    .om-bd{ padding:16px; }
    .om-ft{ padding:12px 16px; border-top:1px solid #263349; display:flex; justify-content:flex-end; gap:8px; }
    .om-btn{ background:#172231; color:#eaf1ff; border:1px solid #2b3b55; border-radius:10px; padding:8px 12px; cursor:pointer; }
    .om-btn.primary{ background:#2a3a55; border-color:#334763; }
  `;
  document.head.appendChild(s);
}
