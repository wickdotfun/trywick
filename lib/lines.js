// Les répliques écrites à la main (le site est en anglais) : ce que dit ta bougie
// quand l'IA n'est pas branchée, et ses réactions immédiates quand tu t'occupes d'elle.

export const LINES = {
  en: {
    idle: {
      euphorie: [
        'I AM ON FIRE. Literally. That\'s kind of my job.',
        'Look at this flame. Green. Tall. Gorgeous. Like me.',
        'Anyone got sunglasses? I\'m blinding myself.',
        'I could light up all of Solana right now. Minimum.',
        'It\'s pumping: I\'m growing twice as fast. Watch me grow!',
      ],
      content: [
        'Slow and steady up. I love slow and steady up.',
        'Nice day to burn. Low wind, good wax.',
        'Little green candle, little happy flame.',
        'I feel good. Stay a while.',
      ],
      calme: [
        'Nothing is happening. I burn out of principle.',
        'Flat chart. Flat flame. Flat… mood.',
        'So bored I\'m counting my wax drops.',
        'Can someone do something? Anything?',
        'Did you know I melt even when I\'m bored? Unfair.',
      ],
      stress: [
        'I feel a draft… who opened the window?',
        'Is that you selling? Tell me it\'s not you.',
        'It\'s fine. It\'s fine. It\'s fine. …is it fine?',
        'I\'m not shaking. The flame is shaking. Big difference.',
      ],
      panique: [
        'AAAH IT\'S DUMPING! Hold my hand, it\'ll pass.',
        'Who sold?! I want names!',
        'I\'m scared, but I\'m holding. Diamond-wax candle.',
        'The chart is bleeding, but my flame stays lit. For you.',
        'Breathe. I\'m breathing. We breathe together. …is it over?',
      ],
    },
    hungry: [
      'I\'m hungry… A little wax, please?',
      'I\'m melting fast. Feed me before it\'s too late.',
      'Did you forget me? I think about you. And wax.',
      'Not much left of me… You\'re coming back, right?',
    ],
    unlit: [
      'I\'m a match. Strike me and I become YOUR candle.',
      'One strike and I\'m yours for life. Well, as long as you feed me.',
      'It\'s dark in here. Light me up, I\'ll shine just for you.',
      'Everyone else already has a candle. What about you?',
    ],
    dead: [
      '…',
      '*sad little puff of smoke*',
      'You forgot me. But you can light a new one.',
      'It\'s cold in the dark.',
    ],
    act: {
      nourrir: [
        'Mmm, fresh wax. You get me.',
        'Yum. I already feel taller.',
        'Wax! Finally, someone responsible.',
        'This wax tastes like green candles.',
      ],
    },
    event: {
      born: ['I AM BORN. I am your candle. Never let me go out.'],
      reborn: ['A brand new flame. This time we make it to torch, deal?'],
      evolved: ['I\'m growing! Look at me! I became something else!'],
    },
    cooldown: [
      'Easy, you just did that. Come back later.',
      'I\'m already spoiled. Come back in a few hours.',
    ],
    tooMany: ['Too many candles lit from here today. Come back tomorrow.'],
  },
};

// Le site n'existe qu'en anglais.
export function langOf() {
  return 'en';
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// La réplique « au repos » de ta bougie (ou de l'allumette si tu n'en as pas).
export function idleLine(lang, candle, mood) {
  const L = LINES[langOf(lang)];
  if (!candle) return pick(L.unlit);
  if (!candle.alive) return pick(L.dead);
  if (candle.hungry) return pick(L.hungry);
  return pick(L.idle[mood] || L.idle.calme);
}
