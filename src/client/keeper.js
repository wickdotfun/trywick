// Parler à un Keeper (l'agent IA d'un coin), ou à The Wick (celui de $WICK) : une petite
// conversation dans la page. Les réponses viennent de /api/ask ; rien n'est gardé côté serveur,
// la conversation vit le temps de la visite.
import { aiLogo, esc, icon } from './util.js';

const ERRORS = {
  too_many: 'Your Keeper needs a breather. Ask again in a little while.',
  ai_busy: 'The Keepers have talked a lot today. Come back tomorrow.',
  ai_off: 'The Keepers are asleep for now. Try again later.',
  ai_failed: 'No answer this time. Try again.',
  bad_question: 'Ask a real question.',
  unknown_coin: 'This Keeper is not lit yet.',
};
const logs = new Map();   // mint → [{ who, text }]

// La boîte de conversation. keeper : { name, label, model, by, logo } (ce qu'on sait déjà de lui).
export function chatHtml({ mint, keeper, symbol, suggestions = [] }) {
  const log = logs.get(mint) || [];
  return `<div class="kchat" data-chat="${esc(mint)}">
    <div class="kchat-log" aria-live="polite">${log.length ? log.map(bubble(keeper)).join('') : `<p class="kchat-empty">${icon('keeper')} Ask ${esc(keeper?.name || 'the Keeper')} anything${symbol ? ` about $${esc(symbol)}` : ''}. It answers in character, from real numbers.</p>`}</div>
    ${suggestions.length ? `<div class="kchat-sugg">${suggestions.map((s) => `<button type="button" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    <form class="kchat-form" autocomplete="off">
      <input name="q" maxlength="240" placeholder="${esc(`Message ${keeper?.name || 'the Keeper'}…`)}" aria-label="Your question">
      <button type="submit" class="cta small-cta" aria-label="Send">${icon('send')}</button>
    </form>
    ${keeper?.model ? `<small class="kchat-foot">${aiLogo(keeper, 12)} ${esc(keeper.model)} by ${esc(keeper.by)} · not financial advice</small>` : ''}
  </div>`;
}

const bubble = (keeper) => (m) => (m.who === 'you'
  ? `<div class="kmsg you"><span>${esc(m.text)}</span></div>`
  : `<div class="kmsg keeper${m.error ? ' err' : ''}"><i class="kmsg-av">${keeper?.logo ? aiLogo(keeper, 14) : icon('keeper')}</i><span>${esc(m.text)}</span></div>`);

// Branche les conversations trouvées dans root. ask({ mint, question }) → { answer, keeper }.
export function bindChats(root, ask) {
  root.querySelectorAll('[data-chat]').forEach((box) => {
    if (box.dataset.bound) return;
    box.dataset.bound = '1';
    const mint = box.dataset.chat;
    const form = box.querySelector('form');
    const log = box.querySelector('.kchat-log');
    let keeper = null;
    let busy = false;
    const push = (m) => {
      const list = logs.get(mint) || [];
      list.push(m);
      logs.set(mint, list.slice(-20));
      log.querySelector('.kchat-empty')?.remove();
      log.insertAdjacentHTML('beforeend', bubble(keeper)(m));
      log.scrollTop = log.scrollHeight;
      return log.lastElementChild;
    };
    async function send(question) {
      const q = question.trim();
      if (!q || busy) return;
      busy = true;
      form.q.value = '';
      form.querySelector('button').disabled = true;
      push({ who: 'you', text: q });
      log.insertAdjacentHTML('beforeend', '<div class="kmsg keeper typing"><i class="kmsg-av"></i><span><b></b><b></b><b></b></span></div>');
      log.scrollTop = log.scrollHeight;
      try {
        const res = await ask({ mint, question: q });
        keeper = res.keeper || keeper;
        log.querySelector('.typing')?.remove();
        const el = push({ who: 'keeper', text: '' });
        await typeOut(el.querySelector('span'), res.answer, log);
        logs.get(mint).at(-1).text = res.answer;
      } catch (err) {
        log.querySelector('.typing')?.remove();
        push({ who: 'keeper', text: ERRORS[err.code] || ERRORS.ai_failed, error: true });
      } finally {
        busy = false;
        form.querySelector('button').disabled = false;
        form.q.focus({ preventScroll: true });
      }
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); send(form.q.value); });
    box.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => send(b.dataset.q)));
  });
}

// La réponse s'écrit lettre par lettre, en moins d'une seconde quoi qu'il arrive (le temps fait
// avancer le texte, pas le nombre d'images : une page chargée ne le ralentit pas).
async function typeOut(el, text, log) {
  const start = performance.now();
  const duration = Math.min(900, text.length * 12);
  for (;;) {
    const t = Math.min(1, (performance.now() - start) / duration);
    el.textContent = text.slice(0, Math.ceil(text.length * t));
    log.scrollTop = log.scrollHeight;
    if (t >= 1) break;
    await new Promise((r) => setTimeout(r, 30));
  }
}
