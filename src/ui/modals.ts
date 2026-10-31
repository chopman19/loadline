// How to play, Stats, Settings, Archive and Unlimited (paywall) dialogs.
import { audio } from '../audio/audio';
import { dailyPuzzle, puzzleRule } from '../core/puzzle';
import { formatDayDate } from '../core/daily';
import { RANKS, rankFor } from '../core/scoring';
import { computeStats, persist, save } from '../state/storage';
import { priceLabel, restorePurchase, startCheckout } from '../state/unlock';
import { $, h } from './dom';
import { icon } from './icons';

interface Hooks {
  onPlayArchive: (day: number) => void;
  onSettings: () => void;
  today: () => number;
}

export class Modals {
  private dlg = $('#modal') as HTMLDialogElement;
  private returnFocus: HTMLElement | null = null;

  constructor(private hooks: Hooks) {
    this.dlg.addEventListener('click', (e) => {
      if (e.target === this.dlg) this.close();
    });
    this.dlg.addEventListener('close', () => {
      this.returnFocus?.focus({ preventScroll: true });
      this.returnFocus = null;
    });
  }

  private open(title: string, ...body: (Node | null)[]): void {
    if (!this.dlg.open) this.returnFocus = document.activeElement as HTMLElement | null;
    const close = h('button', { class: 'icon-btn modal-close', type: 'button', 'aria-label': 'Close', html: icon('close'), onclick: () => this.close() });
    this.dlg.replaceChildren(
      h('div', { class: 'modal-head' }, h('h2', { id: 'modal-title', class: 'modal-title' }, title), close),
      h('div', { class: 'modal-body' }, ...body.filter((b): b is Node => !!b)),
    );
    if (!this.dlg.open) this.dlg.showModal();
    close.focus({ preventScroll: true });
  }

  close(): void {
    if (this.dlg.open) {
      audio.play('click');
      this.dlg.close();
    }
  }

  help(): void {
    const step = (n: number, cls: string, title: string, text: string, scene: Node) =>
      h('li', { class: `how-step ${cls}` }, h('div', { class: 'how-scene', 'aria-hidden': 'true' }, scene), h('div', {}, h('p', { class: 'how-title' }, `${n}. ${title}`), h('p', { class: 'how-text' }, text)));

    const miniShip = (extra: Node[] = []) =>
      h('div', { class: 'mini-ship' }, ...extra, h('div', { class: 'mini-hull' }, h('span', { class: 'mini-line' })), h('div', { class: 'mini-water' }));

    this.open(
      'HOW TO PLAY',
      h('p', { class: 'lead' }, 'Every day a ship waits in the harbour with a ', h('strong', {}, 'load line'), ' painted on its hull: a target population. Load countries as cargo. Each container weighs as much as that country’s population.'),
      h(
        'ol',
        { class: 'how' },
        step(1, 'how-1', 'Pick your cargo', 'Type a country that fits today’s manifest. You won’t see its population until it’s on board.', h('div', { class: 'mini-input' }, h('span', { class: 'mini-typed' }, 'JAPAN'), h('span', { class: 'mini-caret' }))),
        step(2, 'how-2', 'Watch it sink in', 'The crane drops it on deck, the weight is revealed and the ship settles lower in the water.', miniShip([h('div', { class: 'mini-box' }), h('span', { class: 'mini-pop' }, '+122M')])),
        step(3, 'how-3', 'Stop at the line', 'Get as close to the load line as you can, then SET SAIL. Go over and the ship sinks.', miniShip([h('div', { class: 'mini-box b1' }), h('div', { class: 'mini-box b2' })])),
      ),
      h(
        'ul',
        { class: 'rules-list' },
        h('li', {}, 'The ', h('strong', {}, 'hold'), ' fits 3 to 6 containers. When it’s full, you sail automatically.'),
        h('li', {}, 'Countries that break the ', h('strong', {}, 'manifest rule'), ' are turned away. That doesn’t cost you anything.'),
        h('li', {}, 'You get ', h('strong', {}, 'one jettison'), ' per voyage: throw a container overboard to free its slot.'),
        h('li', {}, 'Score = 1000 × load ÷ load line. Overloaded ships score 0, and sinking breaks your streak.'),
        h('li', {}, 'Afterwards a ghost ship shows the best possible load.'),
      ),
      h('div', { class: 'tiers' }, ...RANKS.map((r) => h('span', { class: 'tier', style: `--c:${r.color}` }, r.min >= 0 ? `${r.min === 0 ? '<700' : r.min === 1000 ? '1000' : `${r.min}+`} ${r.name}` : `SUNK ${r.name}`))),
      h('p', { class: 'small' }, 'A new voyage leaves every day at midnight, local time. Populations: UN World Population Prospects 2024, estimates for 2026.'),
      h('button', { class: 'btn btn-big', type: 'button', onclick: () => this.close() }, 'GOT IT'),
    );
  }

  stats(): void {
    const s = computeStats(save.daily, this.hooks.today());
    const max = Math.max(1, ...s.histogram.map((x) => x.count));
    const today = save.daily[this.hooks.today()];
    const todayRank = today ? rankFor(today.score, today.sunk).id : null;
    this.open(
      'STATISTICS',
      h(
        'div',
        { class: 'stat-grid' },
        ...[
          ['PLAYED', s.played],
          ['WIN %', s.winPct],
          ['STREAK', s.streak],
          ['BEST', s.bestStreak],
          ['PERFECT', s.perfect],
        ].map(([label, val]) => h('div', { class: 'stat' }, h('span', { class: 'stat-val' }, String(val)), h('span', { class: 'stat-label' }, String(label)))),
      ),
      h('h3', { class: 'card-title' }, 'RANKS'),
      h(
        'ul',
        { class: 'histo', 'aria-label': 'Daily results by rank' },
        ...s.histogram.map(({ rank, count }) =>
          h(
            'li',
            { class: `histo-row${rank.id === todayRank ? ' today' : ''}` },
            h('span', { class: 'histo-name' }, rank.name),
            h('span', { class: 'histo-bar' }, h('span', { class: 'histo-fill', style: `--w:${count / max};--c:${rank.color}` }, String(count))),
          ),
        ),
      ),
      h('p', { class: 'small' }, `Win % counts voyages that didn’t sink. Archive and Unlimited voyages don’t affect these stats. Practice: ${save.practice.played} played, best ${save.practice.best}.`),
    );
  }

  settings(): void {
    const s = save.settings;
    const toggle = (label: string, desc: string, get: () => boolean, set: (v: boolean) => void) => {
      const btn = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(get()), 'aria-label': label }, h('span', { class: 'switch-knob' }));
      btn.addEventListener('click', () => {
        set(!get());
        btn.setAttribute('aria-checked', String(get()));
        persist();
        this.hooks.onSettings();
        audio.play('click');
      });
      return h('div', { class: 'setting' }, h('div', {}, h('p', { class: 'setting-name' }, label), h('p', { class: 'setting-desc' }, desc)), btn);
    };
    const segmented = <T extends string>(label: string, desc: string, options: [T, string][], get: () => T, set: (v: T) => void) => {
      const group = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
      const paint = () =>
        [...group.children].forEach((b, i) => {
          b.setAttribute('aria-checked', String(options[i][0] === get()));
          b.setAttribute('tabindex', options[i][0] === get() ? '0' : '-1');
        });
      options.forEach(([val, text]) =>
        group.append(
          h(
            'button',
            {
              type: 'button',
              role: 'radio',
              class: 'seg-btn',
              onclick: () => {
                set(val);
                paint();
                persist();
                this.hooks.onSettings();
                audio.play('click');
              },
            },
            text,
          ),
        ),
      );
      group.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const i = options.findIndex(([v]) => v === get());
        const next = (i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length;
        (group.children[next] as HTMLElement).click();
        (group.children[next] as HTMLElement).focus();
      });
      paint();
      return h('div', { class: 'setting col' }, h('div', {}, h('p', { class: 'setting-name' }, label), h('p', { class: 'setting-desc' }, desc)), group);
    };
    this.open(
      'SETTINGS',
      toggle('Sound effects', 'Crane, splashes, horn and the sea.', () => s.sfx, (v) => (s.sfx = v)),
      toggle('Music', 'The lo-fi harbour theme.', () => s.music, (v) => (s.music = v)),
      toggle('Mute everything', 'Same as the speaker button.', () => s.muted, (v) => (s.muted = v)),
      segmented(
        'Reduced motion',
        'Tones down screen shake and big animations.',
        [
          ['auto', 'AUTO'],
          ['reduce', 'ON'],
          ['full', 'OFF'],
        ],
        () => s.motion,
        (v) => (s.motion = v),
      ),
      segmented(
        'Number format',
        'How populations are shown while loading.',
        [
          ['short', '87.4M'],
          ['full', '87,400,000'],
        ],
        () => s.format,
        (v) => (s.format = v),
      ),
    );
  }

  archive(): void {
    const today = this.hooks.today();
    const list = h('ul', { class: 'archive' });
    for (let n = today; n >= 1; n--) {
      const rec = save.daily[n] ?? save.archive[n];
      const p = dailyPuzzle(n);
      const rank = rec ? rankFor(rec.score, rec.sunk) : null;
      list.append(
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: 'arch-row',
              onclick: () => {
                audio.play('click');
                this.dlg.close();
                this.hooks.onPlayArchive(n);
              },
            },
            h('span', { class: 'arch-num' }, `#${n}`),
            h('span', { class: 'arch-info' }, h('span', { class: 'arch-date' }, n === today ? 'TODAY' : formatDayDate(n)), h('span', { class: 'arch-rule' }, puzzleRule(p).text)),
            rec ? h('span', { class: 'arch-score', style: `--c:${rank!.color}` }, rec.sunk ? 'SUNK' : String(rec.score)) : h('span', { class: 'arch-play' }, 'PLAY'),
          ),
        ),
      );
    }
    const intro = today === 1 ? 'Voyage #1 sails today. Past voyages collect here, and you can sail any of them later.' : 'Sail any past voyage. Archive voyages don’t count toward your streak.';
    this.open('ARCHIVE', h('p', { class: 'small' }, intro), list);
  }

  /** Offer to unlock Unlimited. Calls onUnlocked after a restored purchase. */
  paywall(onUnlocked: () => void): void {
    const price = h('p', { class: 'pay-price' }, 'ONE-TIME UNLOCK');
    const msg = h('p', { class: 'pay-msg', role: 'status', 'aria-live': 'polite' });
    const buy = h('button', { class: 'btn btn-lime btn-big', type: 'button' }, 'UNLOCK UNLIMITED');
    buy.addEventListener('click', async () => {
      audio.play('click');
      buy.disabled = true;
      msg.textContent = 'Opening secure checkout…';
      try {
        await startCheckout();
      } catch (e) {
        msg.textContent = (e as Error).message;
        buy.disabled = false;
      }
    });

    const email = h('input', { type: 'email', class: 'pay-email', placeholder: 'you@example.com', autocomplete: 'email', required: true, 'aria-label': 'Email you paid with' });
    const restoreBtn = h('button', { class: 'btn btn-ghost', type: 'submit' }, 'RESTORE');
    const restoreMsg = h('p', { class: 'pay-msg', role: 'status', 'aria-live': 'polite' });
    const form = h('form', { class: 'pay-restore' }, email, restoreBtn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      audio.play('click');
      restoreBtn.disabled = true;
      restoreMsg.textContent = 'Looking for your purchase…';
      try {
        await restorePurchase(email.value);
        this.dlg.close();
        onUnlocked();
      } catch (err) {
        restoreMsg.textContent = (err as Error).message;
        restoreBtn.disabled = false;
      }
    });

    this.open(
      'UNLIMITED',
      h('p', { class: 'lead' }, 'Sail as many voyages as you like, each with a fresh random manifest. The ', h('strong', {}, 'daily voyage stays free'), '.'),
      h(
        'ul',
        { class: 'rules-list' },
        h('li', {}, 'Endless practice voyages, with every manifest rule in the game.'),
        h('li', {}, 'Your best practice score is tracked separately from your daily stats.'),
        h('li', {}, 'Pay once. No account and no subscription.'),
      ),
      price,
      buy,
      msg,
      h('details', { class: 'pay-more' }, h('summary', {}, 'Already paid? Restore your purchase'), h('p', { class: 'small' }, 'Enter the email you used at checkout to unlock this browser.'), form, restoreMsg),
      h('p', { class: 'small' }, 'Payments are handled by Stripe. The unlock is saved in this browser.'),
    );
    priceLabel().then((label) => {
      if (label) price.textContent = `${label} · ONE-TIME UNLOCK`;
    });
  }
}