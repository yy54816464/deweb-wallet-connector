import { BrowserWindow, ipcMain, screen, net } from 'electron';
import path from 'node:path';

/*
 * Minimal Electron main-process relay for the DeWEB wallet connector.
 * The renderer never receives private keys or Node.js access.
 */
const RPC_URLS = {
  '56': 'https://bsc-rpc.publicnode.com',
  '196': 'https://rpc.xlayer.tech',
  '1': 'https://ethereum-rpc.publicnode.com'
};
const FOCUS_METHODS = [
  'eth_requestAccounts', 'wallet_requestPermissions', 'wallet_switchEthereumChain',
  'eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'eth_signTypedData'
];

export function registerWalletBridge(options = {}) {
  const walletUrl = options.walletUrl || 'deweb://app/wallet.html';
  const walletPreload = options.walletPreload;
  if (!walletPreload) throw new Error('walletPreload is required');
  const siteChains = options.siteChains || new Map();
  const log = typeof options.log === 'function' ? options.log : () => {};
  const pending = new Map();
  let walletWindow = null;
  let walletReady = null;
  let seq = 0;

  function ensureWalletWindow() {
    if (walletWindow && !walletWindow.isDestroyed()) return walletWindow;
    const area = screen.getPrimaryDisplay().workArea;
    walletWindow = new BrowserWindow({
      width: 430, height: 680, minWidth: 380, minHeight: 560,
      show: false, alwaysOnTop: true, autoHideMenuBar: true,
      backgroundColor: '#0a0f0c',
      webPreferences: {
        preload: walletPreload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });
    try {
      walletWindow.setPosition(area.x + Math.round((area.width - 430) / 2), area.y + 70);
    } catch (e) {}
    walletReady = new Promise((resolve) => {
      walletWindow.webContents.once('did-finish-load', resolve);
      walletWindow.webContents.once('did-fail-load', resolve);
    });
    walletWindow.loadURL(walletUrl);
    walletWindow.on('closed', () => { walletWindow = null; walletReady = null; });
    return walletWindow;
  }

  function showWalletWindow() {
    const win = ensureWalletWindow();
    try {
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
      win.setAlwaysOnTop(true, 'screen-saver');
    } catch (e) {}
    return win;
  }

  async function shellWallet(req) {
    const wallet = ensureWalletWindow();
    await walletReady;
    if (wallet.isDestroyed()) throw new Error('wallet window is not available');
    const id = ++seq;
    if (FOCUS_METHODS.indexOf(req.method) >= 0) showWalletWindow();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('wallet request timed out'));
      }, 180000);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
        method: req.method, sender: req.sender || null
      });
      wallet.webContents.send('wallet:request', {
        id, origin: req.origin,
        chainHint: req.chainHint || siteChains.get(req.origin) || '',
        method: req.method, params: req.params
      });
    });
  }

  // Site windows call this with only their own frame origin.
  ipcMain.handle('wallet:request', async (event, payload) => {
    const frame = event.senderFrame;
    if (!frame) throw new Error('wallet request has no frame');
    let origin = '';
    try { origin = new URL(frame.url).origin; } catch (e) {}
    if (!/^https?:\/\//i.test(origin)) throw new Error('wallet requests are only allowed from http(s) sites');
    const method = payload && typeof payload.method === 'string' ? payload.method : '';
    if (!method) throw new Error('missing wallet method');
    const hint = String(payload.chainHint || '');
    const chainHint = (hint === '56' || hint === '196' || hint === '1') ? hint : '';
    log('REQ', method, origin, chainHint);
    return shellWallet({ origin, method, params: payload.params, sender: event.sender, chainHint });
  });

  ipcMain.on('wallet:response', (event, msg) => {
    const fromWallet = walletWindow && event.sender === walletWindow.webContents;
    if (!fromWallet) return;
    const p = pending.get(msg && msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) {
      log('ERR', p.method, String(msg.error.message || msg.error));
      p.reject(new Error(String(msg.error.message || msg.error)));
    } else {
      log('OK', p.method);
      p.resolve(msg.result);
    }
    if (pending.size === 0 && walletWindow && !walletWindow.isDestroyed()) {
      setTimeout(() => { try { if (pending.size === 0 && walletWindow) walletWindow.hide(); } catch (e) {} }, 350);
    }
  });

  ipcMain.on('wallet:focusWallet', (event) => {
    if (walletWindow && event.sender === walletWindow.webContents) showWalletWindow();
  });

  ipcMain.handle('wallet:rpc', async (_event, payload) => {
    try {
      const method = String(payload && payload.method || '');
      if (!/^eth_|^net_/.test(method)) return null;
      const chainId = String(payload && payload.chainId || '196');
      const url = RPC_URLS[chainId] || RPC_URLS['196'];
      const r = await net.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: payload.params || [] })
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'rpc error');
      return j.result;
    } catch (e) { return null; }
  });

  return { showWalletWindow, ensureWalletWindow };
}
