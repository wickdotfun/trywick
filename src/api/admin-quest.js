// POST /api/admin/quest avec « Authorization: Bearer <ADMIN_KEY> » : le dev ajoute,
// modifie ou retire une quête, sans toucher au code. Elle se range après les autres.
//   { "id": "reply1", "kind": "x_post", "title": "Reply to our launch post",
//     "text": "Reply with your code.", "url": "https://x.com/trywickdotfun/status/…", "rewardHours": 6 }
//   { "id": "like1", "kind": "honor", "title": "Like the launch post", "url": "…", "rewardHours": 1 }
//   { "id": "reply1", "remove": true }
import { json } from '../../lib/http.js';
import { allQuests } from '../../lib/quests.js';
import { ensureSchema } from '../../lib/schema.js';
import { getKv, setKv } from '../../lib/store.js';
import { forgetQuestCache } from './common.js';

export async function onRequestPost({ request, env }) {
  const key = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  if (typeof body?.id !== 'string' || !/^[a-z0-9_-]{2,32}$/.test(body.id)) return json({ error: 'bad_id' }, 400);
  await ensureSchema(env.DB);
  const extra = (await getKv(env.DB, 'quests.extra')) || [];
  const rest = extra.filter((q) => q.id !== body.id);
  if (!body.remove) {
    if (!['x_post', 'x_photo', 'honor'].includes(body.kind)) return json({ error: 'bad_kind' }, 400);
    const q = {
      id: body.id, kind: body.kind, chapter: body.chapter, title: body.title, text: body.text,
      url: body.url, rewardHours: body.rewardHours,
    };
    const i = extra.findIndex((x) => x.id === body.id);
    if (i >= 0) rest.splice(i, 0, q); else rest.push(q);
  }
  await setKv(env.DB, 'quests.extra', rest);
  forgetQuestCache();
  return json({ ok: true, quests: allQuests(rest).map((q) => ({ id: q.id, kind: q.kind, title: q.title })) });
}
