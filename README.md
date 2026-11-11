# DeWEB Wallet Connector

This repository contains the **wallet connection mechanism** used by DeWEB Desktop. It is intentionally separated from the full desktop application so the wallet bridge can be reviewed independently.

The complete DeWEB Desktop app is **not open sourced here**.

## What is included

```text
src/
  main-wallet-bridge.mjs   minimal Electron main-process relay / IPC
  preload-wallet.cjs       contextBridge API used by the wallet window
  preload-site.cjs         provider exposed to remote sites
  wallet.html              wallet window host
  wallet-service.js        OKX Connect UI + origin policy + request flow
```

## Security model

1. A remote site never receives Node.js or Electron APIs.
2. The site provider (`window.ethereum`) is exposed by `preload-site.cjs` in an isolated world.
3. Every request is sent through IPC to the main process.
4. The main process derives the origin from `event.senderFrame.url`; it does not trust a renderer-supplied origin.
5. Only `http(s)` origins are accepted.
6. The wallet window is a separate `BrowserWindow` with:

```text
contextIsolation: true
sandbox: true
nodeIntegration: false
```

7. The wallet window receives a request, displays the method/params, and asks the user before forwarding it to OKX Connect.
8. OKX / the user's wallet remains the signing authority. **DeWEB never receives or stores private keys.**
9. Requests time out after 180 seconds.
10. A site must be approved per origin before it can use the wallet.

## What this does not do

- It does not store private keys or seed phrases.
- It does not sign transactions on the desktop.
- It does not bypass the mobile wallet confirmation.
- It does not include the OKX UI SDK bundle; obtain it from OKX and review its license.

The mobile confirmation is intentional: the signing key is held by the wallet, not by DeWEB.

## Host wiring

In the desktop main process:

```js
import { registerWalletBridge } from './src/main-wallet-bridge.mjs';

registerWalletBridge({
  walletUrl: 'deweb://app/wallet.html',
  walletPreload: path.join(__dirname, 'preload-wallet.cjs'),
  siteChains,
  log: (...args) => console.log('[wallet]', ...args)
});
```

The host must serve `wallet.html`, `wallet-service.js`, and the official `okx-ui.js` bundle under the wallet URL.

## Required IPC

```text
renderer → main   wallet:request
wallet   → main   wallet:response
wallet   → main   wallet:focusWallet
wallet   → main   wallet:rpc
```

## Audit focus

- `event.senderFrame.url` origin parsing;
- origin approval storage;
- request/response id matching;
- timeout and cleanup;
- no private key material in JS, localStorage, or IPC;
- wallet window isolation;
- remote site preload surface.

## License

MIT for the DeWEB connector code. The OKX Connect SDK/bundle remains under its own license and is not included.
