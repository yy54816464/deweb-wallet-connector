(function(){
  'use strict';
  if (!window.dewebShell || !window.dewebShell.isElectron || !window.dewebShell.onWalletRequest) return;

  var ui = null;
  var accounts = [];
  var chain = 'eip155:196';
  var chainHex = '0xc4';
  var queue = Promise.resolve();
  var APPROVED = 'deweb.electron.wc.origins';
  var ORIGIN_CHAIN = 'deweb.electron.wc.originchain';
  var panelEl = null;
  var siteSession = {};
  var RPCS = { '56': 'https://bsc-rpc.publicnode.com', '196': 'https://rpc.xlayer.tech', '1': 'https://ethereum-rpc.publicnode.com' };
  async function publicRpc(method, params){
    var id = parseInt((chain.split(':')[1] || '196'), 10);
    var url = RPCS[String(id)] || RPCS['196'];
    try {
      var r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: method, params: params || [] })
      });
      var j = await r.json();
      if (j && j.error) throw new Error(j.error.message || 'rpc error');
      if (j && j.result !== undefined) return j.result;
    } catch(e) {}
    try {
      if (window.dewebShell && window.dewebShell.rpc) return await window.dewebShell.rpc(method, params, String(id));
    } catch(e) {}
    return null;
  }
  function loadOkx(){
    if (window.OKXTonConnectUISdk && window.OKXTonConnectUISdk.OKXUniversalConnectUI) return Promise.resolve();
    return new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = './okx-ui.js';
      s.onload = function(){ resolve(); };
      s.onerror = function(){ reject(new Error('OKX Connect bundle failed to load')); };
      document.head.appendChild(s);
    });
  }
  function confirmBox(title, text){
    return new Promise(function(resolve){
      var mask = document.createElement('div');
      mask.className = 'mask on';
      mask.innerHTML = '<div class="modal"><div class="hd"><span>WALLET CONFIRM</span><span class="wc-x" style="cursor:pointer;color:var(--dim)">ESC</span></div>' +
        '<div class="bd"><p id="wcTitle"></p><div class="tip-addr" id="wcBody" style="white-space:pre-wrap;max-height:260px;overflow:auto"></div></div>' +
        '<div class="ft"><button class="btn" id="wcNo">拒绝</button><button class="btn on" id="wcYes">允许</button></div></div>';
      document.body.appendChild(mask);
      mask.querySelector('#wcTitle').textContent = title;
      mask.querySelector('#wcBody').textContent = text;
      function close(v){ mask.remove(); resolve(v); }
      mask.querySelector('.wc-x').onclick = function(){ close(false); };
      mask.querySelector('#wcNo').onclick = function(){ close(false); };
      mask.querySelector('#wcYes').onclick = function(){ close(true); };
    });
  }
  function approved(origin){
    try {
      var a = JSON.parse(localStorage.getItem(APPROVED) || '[]');
      return a.indexOf(origin) >= 0 && !!chainFor(origin);
    } catch(e){ return false; }
  }
  function chainFor(origin){
    try { var m = JSON.parse(localStorage.getItem(ORIGIN_CHAIN) || '{}'); return m[origin] || ''; } catch(e){ return ''; }
  }
  function setChainFor(origin, value){
    try { var m = JSON.parse(localStorage.getItem(ORIGIN_CHAIN) || '{}'); m[origin] = value; localStorage.setItem(ORIGIN_CHAIN, JSON.stringify(m)); } catch(e){}
  }
  function chooseChain(origin){
    return new Promise(function(resolve){
      var mask = document.createElement('div');
      mask.className = 'mask on';
      mask.innerHTML = '<div class="modal"><div class="hd"><span>选择网络</span><span class="wc-x" style="cursor:pointer;color:var(--dim)">ESC</span></div>' +
        '<div class="bd"><p id="chainOrigin" class="tip-addr" style="word-break:break-all"></p>' +
        '<p style="margin-top:10px">这个站点用哪条链？连接后站点会读到对应 chainId。</p>' +
        '<div class="btnrow"><button class="btn on" data-chain="196">X Layer</button><button class="btn" data-chain="56">BNB Chain</button><button class="btn" data-chain="1">Ethereum</button></div></div>' +
        '<div class="ft"><button class="btn" id="chainNo">取消</button></div></div>';
      document.body.appendChild(mask);
      mask.querySelector('#chainOrigin').textContent = origin;
      function close(v){ mask.remove(); resolve(v); }
      mask.querySelector('.wc-x').onclick = function(){ close(''); };
      mask.querySelector('#chainNo').onclick = function(){ close(''); };
      mask.querySelectorAll('[data-chain]').forEach(function(b){
        b.onclick = function(){ close('eip155:' + b.getAttribute('data-chain')); };
      });
    });
  }
  function approve(origin){
    try {
      var a = JSON.parse(localStorage.getItem(APPROVED) || '[]');
      if (a.indexOf(origin) < 0) a.push(origin);
      localStorage.setItem(APPROVED, JSON.stringify(a));
    } catch(e) {}
  }
  function parseAccounts(session){
    try { return (session.namespaces.eip155.accounts || []).map(function(a){ return String(a).split(':').pop(); }); } catch(e){ return []; }
  }
  function dropOkxSession(){
    try {
      if (ui && ui.disconnect){
        var p = ui.disconnect();
        if (p && p.catch) p.catch(function(){});
      }
    } catch(e) {}
    ui = null; accounts = [];
  }
  function openQrModal(opts){
    var modal = ui.openModal(opts);
    return new Promise(function(resolve, reject){
      var seen = false;
      var gone = 0;
      var timer = setInterval(function(){
        try {
          var el = document.getElementById('universal-widget-root');
          var modal = el && el.querySelector('[data-tc-modal]');
          var rect = modal ? modal.getBoundingClientRect() : (el ? el.getBoundingClientRect() : null);
          var visible = !!(rect && rect.width > 0 && rect.height > 0);
          if (visible){ seen = true; gone = 0; }
          else if (seen){
            gone++;
            if (gone >= 2){
              clearInterval(timer);
              reject(Object.assign(new Error('User rejected'), { code: 4001 }));
            }
          }
        } catch(e) {}
      }, 400);
      modal.then(function(v){ clearInterval(timer); resolve(v); })
           .catch(function(e){ clearInterval(timer); reject(e); });
    });
  }
  async function ensureUi(){
    await loadOkx();
    if (!window.OKXTonConnectUISdk || !window.OKXTonConnectUISdk.OKXUniversalConnectUI) throw new Error('OKX Connect unavailable');
    if (!ui){
      ui = await window.OKXTonConnectUISdk.OKXUniversalConnectUI.init({
        dappMetaData: {
          icon: 'https://1-2-399.tapekit.org/favicon.ico',
          name: 'DeWEB Desktop'
        },
        actionsConfiguration: {
          modals: 'all',
          returnStrategy: 'none',
          tmaReturnUrl: 'back'
        },
        language: 'zh_CN',
        uiPreferences: { theme: 'DARK' },
        restoreConnection: true
      });
    }
    if (accounts.length && ui){
      try {
        var check = await Promise.race([
          ui.request({ method: 'eth_accounts', params: [] }, chain),
          new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('wallet session stale')); }, 2500); })
        ]);
        if (!Array.isArray(check) || !check.length) throw new Error('wallet session empty');
      } catch (e) {
        dropOkxSession();
      }
    }
    if (!accounts.length){
      var defaultChain = (chain.split(':')[1] || '196');
      var session;
      try {
        session = await openQrModal({
          namespaces: { eip155: { chains: ['eip155:196','eip155:56','eip155:1'], defaultChain: defaultChain } },
          optionalNamespaces: { eip155: { chains: ['eip155:56','eip155:1'] } }
        });
      } catch (e) {
        ui = null;
        accounts = [];
        throw e;
      }
      accounts = parseAccounts(session);
      if (!accounts.length){
        try { var got = await ui.request({ method:'eth_accounts', params: [] }, chain); if (Array.isArray(got)) accounts = got; } catch(e){}
      }
    }
    if (!accounts.length) throw new Error('no wallet account');
    return ui;
  }
  function refreshPanel(){
    if (!panelEl) return;
    var st = panelEl.querySelector('#okxStatus');
    var btn = panelEl.querySelector('#okxConnect');
    var dis = panelEl.querySelector('#okxDisconnect');
    if (st) st.textContent = accounts.length ? (accounts[0] + ' · ' + chainHex) : '未连接';
    if (btn) btn.disabled = !!accounts.length;
    if (dis) dis.disabled = !accounts.length;
  }
  function openPanel(){
    if (panelEl){ panelEl.classList.add('on'); refreshPanel(); return; }
    panelEl = document.createElement('div');
    panelEl.className = 'mask on';
    panelEl.innerHTML = '<div class="modal"><div class="hd"><span>连接钱包</span><span id="okxClose" style="cursor:pointer;color:var(--dim)">ESC</span></div>' +
      '<div class="bd"><p>用 OKX App 扫二维码连接。不需要 Project ID。</p>' +
      '<div class="tip-addr" id="okxStatus">未连接</div>' +
      '<div class="btnrow"><button class="btn on" id="okxConnect">扫码连接</button><button class="btn" id="okxDisconnect">断开</button></div>' +
      '<div class="tip-note">只连接 OKX App；站点仍需按 origin 授权，交易逐笔确认。</div></div>' +
      '<div class="ft"><button class="btn" id="okxPanelClose">关闭</button></div></div>';
    document.body.appendChild(panelEl);
    function close(){ panelEl.classList.remove('on'); }
    panelEl.querySelector('#okxClose').onclick = close;
    panelEl.querySelector('#okxPanelClose').onclick = close;
    panelEl.addEventListener('click', function(e){ if (e.target === panelEl) close(); });
    panelEl.querySelector('#okxConnect').onclick = async function(){
      try { await ensureUi(); refreshPanel(); } catch(e){ var st=panelEl.querySelector('#okxStatus'); if(st) st.textContent='连接失败：' + String(e.message||e); }
    };
    panelEl.querySelector('#okxDisconnect').onclick = async function(){
      try { if (ui && ui.disconnect) await ui.disconnect(); } catch(e) {}
      ui = null; accounts = []; siteSession = {}; chain = 'eip155:196'; chainHex = '0xc4'; refreshPanel();
    };
    refreshPanel();
  }
  async function handle(req){
    function ok(result){ window.dewebShell.sendWalletResponse({ id: req.id, result: result }); }
    function fail(e){ window.dewebShell.sendWalletResponse({ id: req.id, error: { code: (e && e.code) || -32603, message: String((e && e.message) || e) } }); }
    try {
      var origin = req.origin || 'unknown';
      var method = req.method;
      var params = req.params || [];
      var hint = String(req.chainHint || '');
      if (hint) setChainFor(origin, 'eip155:' + hint);
      var oc = chainFor(origin);
      if (oc){ chain = oc; chainHex = '0x' + parseInt(oc.split(':')[1], 10).toString(16); }
      if (method === 'eth_chainId') return ok(chainHex);
      if (method === 'net_version') return ok(String(parseInt(chainHex, 16)));
      if (method === 'eth_accounts') return ok(((hint || siteSession[origin]) && approved(origin)) ? accounts : []);
      if (method === 'eth_requestAccounts' || method === 'wallet_requestPermissions'){
        if (method === 'wallet_requestPermissions' && !hint){
          /* AppKit always starts a fresh connect with wallet_requestPermissions.
             Never reuse a stale OKX UI session: that produced accounts but
             wallet_switchEthereumChain then failed with "Connect wallet". */
          try { if (window.dewebShell.focusWallet) window.dewebShell.focusWallet(); } catch(e){}
          dropOkxSession();
          delete siteSession[origin];
        }
        /* 普通 web 的 OKX/AppKit 连接器只有在“没有现成会话”时才走扫码。
           复用主站已连接会话会让它停在扩展连接器上，所以 web 首次连接强制新扫码。 */
        if (!hint && accounts.length && !siteSession[origin]){
          try { if (window.dewebShell.focusWallet) window.dewebShell.focusWallet(); } catch(e) {}
          dropOkxSession();
          delete siteSession[origin];
        }
        var needApprove = !approved(origin);
        if (needApprove){
          if (!hint){
            try { if (window.dewebShell.focusWallet) window.dewebShell.focusWallet(); } catch(e){}
            await new Promise(function(r){ setTimeout(r, 120); });
            var picked = await chooseChain(origin);
            if (!picked) throw Object.assign(new Error('User rejected'), { code: 4001 });
            setChainFor(origin, picked);
          }
        }
        oc = chainFor(origin);
        if (oc){ chain = oc; chainHex = '0x' + parseInt(oc.split(':')[1], 10).toString(16); }
        try {
          await ensureUi();
        } catch (e) {
          dropOkxSession();
          delete siteSession[origin];
          throw e;
        }
        if (needApprove) approve(origin);
        siteSession[origin] = true;
        if (method === 'wallet_requestPermissions') return ok({ eth_accounts: { caveats: [] } });
        return ok(accounts);
      }
      if (method === 'wallet_switchEthereumChain'){
        await ensureUi();
        var target = params && params[0] && params[0].chainId;
        if (!target) throw new Error('missing chainId');
        var dec = parseInt(target, 16);
        var targetChain = 'eip155:' + dec;
        var r = await ui.request({ method: method, params: params }, targetChain);
        chain = targetChain; chainHex = '0x' + dec.toString(16); setChainFor(origin, targetChain);
        return ok(r);
      }
      if (method === 'eth_sendTransaction'){
        await ensureUi();
        var tx = (params && params[0]) || {};
        var yes = await confirmBox('发送交易', '站点：' + origin + '\n\n' + JSON.stringify(tx, null, 2).slice(0, 4000));
        if (!yes) throw Object.assign(new Error('User rejected'), { code: 4001 });
        return ok(await ui.request({ method: method, params: params }, chain));
      }
      if (method === 'personal_sign' || method === 'eth_signTypedData_v4'){
        await ensureUi();
        var okSign = await confirmBox('签名请求', '站点：' + origin + '\n\n' + JSON.stringify(params, null, 2).slice(0, 4000));
        if (!okSign) throw Object.assign(new Error('User rejected'), { code: 4001 });
        return ok(await ui.request({ method: method, params: params }, chain));
      }
      var reads = ['eth_call','eth_estimateGas','eth_getBalance','eth_blockNumber','eth_getTransactionReceipt','eth_getCode','eth_getTransactionCount','eth_gasPrice','eth_feeHistory','eth_getLogs','eth_getBlockByNumber','eth_getTransactionByHash','eth_getBlockByHash','eth_getStorageAt','eth_maxPriorityFeePerGas'];
      if (reads.indexOf(method) >= 0){
        return ok(await publicRpc(method, params));
      }
      throw new Error('unsupported wallet method: ' + method);
    } catch(e) { fail(e); }
  }

  window.dewebShell.onWalletRequest(function(req){
    queue = queue.then(function(){ return handle(req); });
  });
  setTimeout(function(){
    var b = document.getElementById('wcBtn');
    if (b){ b.style.display = 'inline-flex'; b.textContent = '连接钱包'; b.title = '连接钱包 / OKX Connect'; b.onclick = openPanel; }
  }, 0);
})();
