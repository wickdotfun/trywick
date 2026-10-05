// Le message que le wallet du créateur signe pour relier (ou délier) le compte X de son coin. Le
// même texte côté site (src/client) et côté serveur (lib/xoperator.js), qui le vérifie.
export const proofMessage = ({ action, symbol, mint, wallet, at }) =>
  `WICK: ${action === 'unlink' ? 'disconnect the X account of' : 'let its Operator post on X for'} $${symbol}\nCoin: ${mint}\nWallet: ${wallet}\nTime: ${new Date(at).toISOString()}`;
