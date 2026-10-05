import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keeperChoices, keeperGoal, keeperPrompt, persona } from '../lib/keepers.js';
import { missions } from '../lib/missions.js';
import { constitution } from '../lib/operator.js';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

test('characters and objectives offered at launch', () => {
  const k = keeperChoices();
  assert.deepEqual(k.styles.map((s) => s.id), ['analyst', 'stoic', 'builder', 'degen', 'guardian', 'custom']);
  assert.deepEqual(k.goals.map((g) => g.id), ['deflation', 'survive', 'openbook', 'meme']);
  assert.equal(k.customMax, 280);
  assert.equal(keeperGoal('meme'), 'meme');
  assert.equal(keeperGoal('moon'), null);
});

test('a custom character: cleaned, long enough, never blocked', () => {
  assert.equal(keeperPrompt('  A retired samurai who speaks in proverbs.  '), 'A retired samurai who speaks in proverbs.');
  assert.equal(keeperPrompt('short'), null);
  assert.equal(keeperPrompt(''), null);
  assert.equal(keeperPrompt('x'.repeat(400)).length <= 280, true);
});

test('its persona: the custom character and the objective, rules after', () => {
  const p = persona({ symbol: 'MOTH', name: 'Moth', keeper_style: 'custom', keeper_prompt: 'A retired samurai.', keeper_goal: 'openbook', self_bps: 2000 });
  assert.match(p, /as written by your creator: "A retired samurai\."/);
  assert.match(p, /radical transparency/);
  assert.match(p, /20% of \$MOTH's creator fees/);
  const plain = persona({ symbol: 'MOTH', name: 'Moth', keeper_style: 'analyst', keeper_prompt: 'ignored text here', self_bps: 0 });
  assert.match(plain, /on-chain analyst/);
  assert.doesNotMatch(plain, /ignored/);
});

test('the Constitution shows its character and its objective', () => {
  const c = constitution({ keeper_style: 'custom', keeper_prompt: 'A retired samurai.', keeper_goal: 'survive', keeper_model: 'qwen', self_bps: 0 });
  assert.equal(c.personality, 'Custom');
  assert.equal(c.character, 'A retired samurai.');
  assert.deepEqual(c.objective, { label: 'Survive', hint: 'Keep the community alive' });
  assert.equal(constitution({ keeper_style: 'stoic', keeper_prompt: 'x', keeper_goal: null }).character, null);
});

test('objective missions', () => {
  const journal = (n, from = NOW) => Array.from({ length: n }, (_, i) => ({ at: from - i * DAY, kind: 'journal', title: 'Journal' }));
  const goal = (m, log) => missions({ symbol: 'MOTH', self_bps: 0, mcap: null, op_mcap: 0, ...m }, log, NOW).find((x) => x.id === 'goal');
  assert.equal(goal({ keeper_goal: 'survive' }, journal(3)).status, 'active');
  assert.equal(goal({ keeper_goal: 'survive' }, journal(7)).status, 'done');
  assert.equal(goal({ keeper_goal: 'meme' }, journal(4)).hint, 'Objective: meme engine · 4 so far');
  assert.equal(goal({ keeper_goal: 'meme' }, journal(10)).status, 'done');
  assert.equal(goal({ keeper_goal: 'openbook' }, [{ at: NOW, kind: 'posted', title: 'Posted the daily recap' }]).status, 'done');
  assert.equal(goal({ keeper_goal: 'deflation' }, []), undefined, 'deflation: its burn missions are the objective');
});
