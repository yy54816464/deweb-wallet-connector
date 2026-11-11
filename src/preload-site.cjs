const { contextBridge, ipcRenderer, webFrame } = require('electron');

function hostChainHint(){
  try {
    var h = String(location.hostname || '');
    if (!/(^|\.)tapeout\.site$|(^|\.)tapekit\.org$/i.test(h)) return '';
    var p = h.split('.')[0].split('-');
    if (p.length === 2) return '56';
    if (p.length === 3 && p[1] === '2') return '196';
    if (p.length === 3 && p[1] === '3') return '1';
  } catch(e) {}
  return '';
}
const READS = ['eth_call','eth_estimateGas','eth_getBalance','eth_blockNumber','eth_getTransactionReceipt','eth_getCode','eth_getTransactionCount','eth_gasPrice','eth_feeHistory','eth_getLogs','eth_getBlockByNumber','eth_getTransactionByHash','eth_getBlockByHash','eth_getStorageAt','eth_maxPriorityFeePerGas'];
const RPCS = { '56':'https://bsc-rpc.publicnode.com', '196':'https://rpc.xlayer.tech', '1':'https://ethereum-rpc.publicnode.com' };
function chainOf(){ var h=hostChainHint(); return h || '196'; }
function chainHexOf(){ var c=chainOf(); return c==='56'?'0x38':(c==='1'?'0x1':'0xc4'); }
async function publicRead(method, params){
  var c = chainOf();
  var r = await fetch(RPCS[c] || RPCS['196'], {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ jsonrpc:'2.0', id:Date.now(), method:method, params:params || [] })
  });
  var j = await r.json();
  if (j.error) throw new Error(j.error.message || 'rpc error');
  return j.result;
}
const listeners = [];
const ethereum = {
  isDeWeb: true,
  isMetaMask: true,
    isOkxWallet: true,
    isOKExWallet: true,
  chainId: chainHexOf(),
  networkVersion: String(parseInt(chainHexOf(), 16)),
  selectedAddress: null,
  request: async (args) => {
    const a = args || {};
    if (a.method === 'eth_chainId') return chainHexOf();
    if (a.method === 'net_version') return String(parseInt(chainHexOf(), 16));
    if (READS.indexOf(a.method) >= 0 && hostChainHint()) return publicRead(a.method, a.params);
    return ipcRenderer.invoke('wallet:request', { method: a.method, params: a.params, chainHint: hostChainHint() });
  },
  enable: () => ipcRenderer.invoke('wallet:request', { method: 'eth_requestAccounts', params: [], chainHint: hostChainHint() }),
  connect: () => ipcRenderer.invoke('wallet:request', { method: 'eth_requestAccounts', params: [], chainHint: hostChainHint() }),
  isConnected: () => true,
  on: (event, cb) => {
    const ch = 'wallet:event:' + String(event);
    const handler = (_e, data) => { try { cb(data); } catch (err) {} };
    ipcRenderer.on(ch, handler);
    listeners.push({ ch, handler });
  },
  removeListener: (event) => {
    const ch = 'wallet:event:' + String(event);
    for (let i = listeners.length - 1; i >= 0; i--) {
      if (listeners[i].ch === ch) { ipcRenderer.removeListener(ch, listeners[i].handler); listeners.splice(i, 1); }
    }
  }
};
try { contextBridge.exposeInMainWorld('ethereum', ethereum);
  try { contextBridge.exposeInMainWorld('okxwallet', ethereum); } catch (e) {}
  try { contextBridge.exposeInMainWorld('okexwallet', ethereum); } catch (e) {} } catch (e) {}
try { contextBridge.exposeInMainWorld('dewebWallet', { isDeWeb: true, version: 1 }); } catch (e) {}



/* ── Add this web page to the desktop (draggable) ── */
(function(){
  function addButton(){
    try {
      if (!/^https?:$/.test(location.protocol)) return;
      if (document.getElementById('deweb-add-desktop')) return;
      var host = location.hostname || 'web';
      var key = 'deweb.addweb.pos:' + host;
      var b = document.createElement('button');
      b.id = 'deweb-add-desktop';
      b.type = 'button';
      b.textContent = '＋ 桌面';
      b.title = '拖动调整位置；点击添加到桌面';
      b.setAttribute('aria-label', '添加此页面到桌面');
      b.style.cssText = 'position:fixed;left:14px;bottom:16px;right:auto;top:auto;z-index:2147483647;padding:8px 11px;border:1px solid rgba(255,255,255,.24);border-radius:12px;background:rgba(11,24,17,.78);color:#dff5e9;font:11px/1.2 ui-monospace,Consolas,monospace;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;backdrop-filter:blur(18px);box-shadow:0 8px 24px rgba(0,0,0,.22)';
      try {
        var saved = JSON.parse(localStorage.getItem(key) || 'null');
        if (saved && typeof saved.x === 'number' && typeof saved.y === 'number'){
          b.style.left = saved.x + 'px';
          b.style.top = saved.y + 'px';
          b.style.right = 'auto';
          b.style.bottom = 'auto';
        }
      } catch(e) {}
      var down = null, moved = false, suppressClick = false;
      function clampPos(left, top){
        var r = b.getBoundingClientRect();
        return {
          x: Math.max(4, Math.min(window.innerWidth - r.width - 4, left)),
          y: Math.max(4, Math.min(window.innerHeight - r.height - 4, top))
        };
      }
      b.addEventListener('mouseenter', function(){ b.style.borderColor = '#56e6b0'; b.style.color = '#fff'; });
      b.addEventListener('mouseleave', function(){ b.style.borderColor = 'rgba(255,255,255,.24)'; b.style.color = '#dff5e9'; });
      b.addEventListener('pointerdown', function(e){
        if (e.button !== 0) return;
        var r = b.getBoundingClientRect();
        down = { id:e.pointerId, sx:e.clientX, sy:e.clientY, x:r.left, y:r.top };
        moved = false;
        b.style.cursor = 'grabbing';
        try { b.setPointerCapture(e.pointerId); } catch(err) {}
        e.preventDefault();
        e.stopPropagation();
      });
      b.addEventListener('pointermove', function(e){
        if (!down || e.pointerId !== down.id) return;
        var dx = e.clientX - down.sx, dy = e.clientY - down.sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        moved = true;
        var p = clampPos(down.x + dx, down.y + dy);
        b.style.left = p.x + 'px';
        b.style.top = p.y + 'px';
        b.style.right = 'auto';
        b.style.bottom = 'auto';
        e.preventDefault();
        e.stopPropagation();
      });
      function endDrag(e){
        if (!down) return;
        down = null;
        b.style.cursor = 'grab';
        if (moved){
          suppressClick = true;
          try {
            localStorage.setItem(key, JSON.stringify({ x: parseFloat(b.style.left) || 0, y: parseFloat(b.style.top) || 0 }));
          } catch(err) {}
        }
        try { b.releasePointerCapture(e.pointerId); } catch(err) {}
        e.preventDefault();
        e.stopPropagation();
      }
      b.addEventListener('pointerup', endDrag);
      b.addEventListener('pointercancel', endDrag);
      b.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        if (suppressClick){ suppressClick = false; return; }
        try { ipcRenderer.send('deweb:add-current-web', { url: location.href, title: document.title }); } catch(err) {}
        b.textContent = '✓ 已添加';
        setTimeout(function(){ try { b.textContent = '＋ 桌面'; } catch(err) {} }, 1400);
      });
      (document.body || document.documentElement).appendChild(b);
    } catch(e) {}
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', addButton, { once:true });
  else addButton();
})();
