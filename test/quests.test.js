import assert from 'node:assert/strict';
import test from 'node:test';
import { dayOf, nextStreak } from '../lib/candles.js';
import { BASE_QUESTS, allQuests, hasCode, parseStatusUrl, questCode, questStates, readOembed } from '../lib/quests.js';

test('status links from x.com and twitter.com are understood', () => {
  assert.deepEqual(parseStatusUrl('https://x.com/Akimbo365/status/1839012345678901234?s=20'), { user: 'Akimbo365', id: '1839012345678901234' });
  assert.deepEqual(parseStatusUrl('https://mobile.twitter.com/a_b/status/123456789'), { user: 'a_b', id: '123456789' });
  assert.equal(parseStatusUrl('https://x.com/Akimbo365'), null);
  assert.equal(parseStatusUrl('https://evil.com/x.com/a/status/123456'), null);
  assert.equal(parseStatusUrl(null), null);
});

test('oEmbed answers give the author and the text', () => {
  const r = readOembed({
    author_url: 'https://twitter.com/Akimbo365',
    html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Claiming my candle 🕯️<br><br>WICK-7F3KQ<br><br><a href="https://twitter.com/trywickdotfun">@trywickdotfun</a> &amp; friends</p>&mdash; Rio (@Akimbo365) <a href="#">Sep 29</a></blockquote>',
  });
  assert.equal(r.author, 'Akimbo365');
  assert.ok(r.text.includes('WICK-7F3KQ'));
  assert.ok(r.text.includes('@trywickdotfun & friends'));
  assert.ok(!r.text.includes('Sep 29'));
  assert.ok(hasCode(r.text, 'wick-7f3kq'));
  assert.ok(hasCode('my code: WICK - 7F3KQ', 'WICK-7F3KQ'));
  assert.ok(!hasCode(r.text, 'WICK-AAAAA'));
});

test('a player code is stable and looks like WICK-XXXXX', async () => {
  const a = await questCode('player1', 'salt');
  assert.match(a, /^WICK-[A-Z2-9]{5}$/);
  assert.equal(a, await questCode('player1', 'salt'));
  assert.notEqual(a, await questCode('player2', 'salt'));
});

test('quests unlock one at a time, in order', () => {
  const quests = allQuests();
  const none = questStates(quests, new Map(), {});
  assert.equal(none[0].status, 'current');
  assert.ok(none.slice(1).every((q) => q.status === 'locked'));
  const rows = new Map([['claim', { done_at: 1 }], ['follow', { started_at: 1000 }]]);
  const s = questStates(quests, rows, {}, 5000);
  assert.equal(s[0].status, 'done');
  assert.equal(s[1].status, 'current');
  assert.equal(s[1].ready, false);
  assert.equal(questStates(quests, rows, {}, 9100)[1].ready, true);
});

test('game quests are ready when the goal is reached', () => {
  const quests = allQuests();
  const rows = new Map([['claim', { done_at: 1 }], ['follow', { done_at: 2 }]]);
  const feed3 = (streak) => questStates(quests, rows, { feedStreak: streak }).find((q) => q.id === 'feed3');
  assert.deepEqual(feed3(2).progress, { have: 2, goal: 3 });
  assert.equal(feed3(2).ready, false);
  assert.equal(feed3(5).ready, true);
  assert.deepEqual(feed3(5).progress, { have: 3, goal: 3 });
});

test('extra quests from the dev come after the base ones and are sanitized', () => {
  const q = allQuests([
    { id: 'reply1', kind: 'x_post', title: 'Reply to the launch', url: 'https://x.com/trywickdotfun/status/1', rewardHours: 6 },
    { id: 'claim', kind: 'honor', title: 'dupe' },
    { id: 'evil', kind: 'x_claim', title: 'second claim' },
    { id: 'bad', kind: 'nope' },
    { id: 'big', kind: 'honor', title: 'Big', url: 'javascript:alert(1)', rewardHours: 999 },
  ]);
  assert.equal(q.length, BASE_QUESTS.length + 2);
  assert.equal(q.at(-2).id, 'reply1');
  assert.equal(q.at(-1).rewardMs, 48 * 3600_000);
  assert.equal(q.at(-1).url, undefined);
});

test('day streaks: same day counts once, a missed day resets', () => {
  const d = dayOf(Date.UTC(2026, 8, 29, 12));
  assert.equal(nextStreak(d, 4, d), 4);
  assert.equal(nextStreak(d - 1, 4, d), 5);
  assert.equal(nextStreak(d - 2, 4, d), 1);
  assert.equal(nextStreak(0, 0, d), 1);
});
