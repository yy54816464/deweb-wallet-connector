const { contextBridge, ipcRenderer } = require('electron');

const isMainFrame = !!(process && process.isMainFrame);

if (isMainFrame) {
  try {
    contextBridge.exposeInMainWorld('dewebShell', {
      isElectron: true,
      platform: process.platform,
      versions: { electron: process.versions.electron, chrome: process.versions.chrome },
      openExternal: (url) => ipcRenderer.invoke('deweb:openExternal', String(url || '')),
      listBrowsers: () => ipcRenderer.invoke('deweb:listBrowsers'),
      openInBrowser: (url, id) => ipcRenderer.invoke('deweb:openInBrowser', { url: String(url || ''), id: String(id || '') }),
      openSite: (url, chain) => ipcRenderer.invoke('deweb:openSite', { url: String(url || ''), chain: String(chain || 'web') }),
      focusSite: (key) => ipcRenderer.invoke('deweb:focusSite', String(key || '')),
      closeSite: (key) => ipcRenderer.invoke('deweb:closeSite', String(key || '')),
      onSiteEvent: (cb) => ipcRenderer.on('deweb:site-event', (_event, data) => { try { cb(data); } catch (e) {} }),
      prewarm: (list) => ipcRenderer.invoke('deweb:prewarm', Array.isArray(list) ? list : []),
      onWalletRequest: (cb) => ipcRenderer.on('wallet:request', (_event, data) => { try { cb(data); } catch (e) {} }),
      onAddWeb: (cb) => ipcRenderer.on('deweb:add-web', (_event, data) => { try { cb(data); } catch (e) {} }),
      sendWalletResponse: (data) => ipcRenderer.send('wallet:response', data),
      focusWallet: () => ipcRenderer.send('wallet:focusWallet'),
      rpc: (method, params, chainId) => ipcRenderer.invoke('wallet:rpc', { method: String(method || ''), params: params || [], chainId: String(chainId || '196') })
    });
  } catch (e) {}
} else {
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
const listeners = [];
  const ethereum = {
    isDeWeb: true,
    isMetaMask: true,
    isOkxWallet: true,
    isOKExWallet: true,
    chainId: '0xc4',
    networkVersion: '196',
    selectedAddress: null,
    request: (args) => {
      const a = args || {};
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
    removeListener: (event, cb) => {
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
}
