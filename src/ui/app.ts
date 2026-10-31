// The game controller: screens, the loading flow and everything that ties the
// scene, the sound and the saved progress together.
import { Scene } from '../scene/scene';
import { audio } from '../audio/audio';
import { dailyPuzzle, puzzleRule, unlimitedPuzzle, type Puzzle } from '../core/puzzle';
import { COFFEE_URL } from '../config';
import { dayNumber, formatCountdown, formatDayDate, msUntilNextDay } from '../core/daily';
import { byIso3, type Country } from '../core/countries';
import { resolve, search } from '../core/match';
import { formatFull, formatPercent, formatPop } from '../core/format';
import { finalScore, jettison, newVoyage, totalOf, tryLoad, type VoyageState } from '../core/voyage';
import { rankFor } from '../core/scoring';
import { shareText } from '../core/share';
import { computeStats, persist, save, type VoyageRecord } from '../state/storage';
import { claimCheckoutReturn, isUnlocked } from '../state/unlock';
import { flagElement } from '../scene/flags';
import { $, h, sleep } from './dom';
import { icon } from './icons';
import { Modals } from './modals';
import { hashString } from '../core/rng';

type Screen = 'home' | 'game' | 'result';

const CARGO_COLORS = ['#b4472f', '#2f6fa8', '#3f8f5a', '#e07b2a', '#2a9d8f', '#8a3550', '#c9962e', '#5d6b8a', '#7a4fa0', '#c2553a'];

export class App {
  private scene!: Scene;
  private screen: Screen = 'home';
  private today = dayNumber();
  private puzzle: Puzzle = dailyPuzzle(this.today);
  private voyage: VoyageState = newVoyage(this.puzzle);
  private busy = false;
  private jettisonMode = false;
  private modals!: Modals;
  private reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  // game-screen elements
  private input!: HTMLInputElement;
  private list!: HTMLUListElement;
  private msg!: HTMLElement;
  private cargo!: HTMLElement;
  private sailBtn!: HTMLButtonElement;
  private jetBtn!: HTMLButtonElement;
  private loadBtn!: HTMLButtonElement;
  private holdCount!: HTMLElement;
  private suggestions: Country[] = [];
  private active = -1;

  start(): void {
    this.applySettings();
    this.scene = new Scene($('#scene') as HTMLCanvasElement, (c) => audio.play(c), () => this.reduced());
    this.scene.start();
    this.modals = new Modals({
      onPlayArchive: (n) => this.openDay(n),
      onSettings: () => this.applySettings(),
      today: () => this.today,
    });

    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: false, passive: true });
    window.addEventListener('keydown', unlock, { once: false });
    this.reduceQuery.addEventListener('change', () => this.applySettings());

    this.wireChrome();
    this.renderFooter();

    // Resume a voyage in progress.
    const cur = save.current;
    if (cur && !cur.outcome) {
      if (cur.kind === 'daily' && cur.id !== this.today) cur.kind = 'archive';
      const p = cur.kind === 'unlimited' ? unlimitedPuzzle(cur.id) : dailyPuzzle(cur.id, cur.kind);
      this.startVoyage(p, cur);
    } else {
      save.current = null;
      this.showHome();
    }
    if (!save.seenHelp) {
      save.seenHelp = true;
      persist();
      this.modals.help();
    }
    setInterval(() => this.tick(), 1000);

    // Back from Stripe Checkout?
    claimCheckoutReturn().then((ok) => {
      if (ok === null) return;
      if (ok) {
        audio.play('fanfare');
        this.toast('UNLIMITED UNLOCKED. FAIR WINDS!');
        if (this.screen === 'home') this.showHome();
      } else {
        this.toast('COULDN’T CONFIRM THE PAYMENT YET');
      }
    });
  }

  // ------------------------------------------------------------------ chrome

  private reduced(): boolean {
    const m = save.settings.motion;
    return m === 'reduce' || (m === 'auto' && this.reduceQuery.matches);
  }

  private applySettings(): void {
    document.body.classList.toggle('reduce-motion', this.reduced());
    audio.configure(save.settings);
    const btn = document.getElementById('btn-sound');
    if (btn) {
      btn.querySelector('.ico')!.innerHTML = icon(save.settings.muted ? 'mute' : 'sound');
      btn.setAttribute('aria-pressed', String(save.settings.muted));
      btn.setAttribute('aria-label', save.settings.muted ? 'Unmute sound' : 'Mute sound');
    }
    if (this.screen === 'game') this.updateGame();
  }

  private wireChrome(): void {
    $('#brand').querySelector('.brand-anchor')!.innerHTML = icon('anchor');
    $('#btn-help').querySelector('.ico')!.innerHTML = icon('help');
    $('#btn-stats').querySelector('.ico')!.innerHTML = icon('stats');
    $('#btn-settings').querySelector('.ico')!.innerHTML = icon('gear');
    const click = (fn: () => void) => () => {
      audio.unlock();
      audio.play('click');
      fn();
    };
    $('#btn-help').addEventListener('click', click(() => this.modals.help()));
    $('#btn-stats').addEventListener('click', click(() => this.modals.stats()));
    $('#btn-settings').addEventListener('click', click(() => this.modals.settings()));
    $('#btn-sound').addEventListener('click', () => {
      audio.unlock();
      save.settings.muted = !save.settings.muted;
      persist();
      this.applySettings();
      audio.play('click');
    });
    $('#brand').addEventListener('click', click(() => !this.busy && this.showHome()));
  }

  private fmt(n: number): string {
    return formatPop(n, save.settings.format);
  }

  private renderFooter(): void {
    const f = $('#footer');
    f.replaceChildren(
      h('span', {}, `Voyage #${this.today}`),
      h('span', { class: 'dot', 'aria-hidden': 'true' }, '·'),
      h('button', { class: 'link', type: 'button', onclick: () => this.modals.help() }, 'How to play'),
      h('span', { class: 'dot', 'aria-hidden': 'true' }, '·'),
      h('button', { class: 'link', type: 'button', onclick: () => this.modals.stats() }, 'Stats'),
      h('span', { class: 'dot', 'aria-hidden': 'true' }, '·'),
      h('button', { class: 'link', type: 'button', onclick: () => this.modals.archive() }, 'Archive'),
      h('span', { class: 'dot', 'aria-hidden': 'true' }, '·'),
      h('span', {}, 'next voyage in ', h('span', { 'data-countdown': '' }, formatCountdown(msUntilNextDay()))),
      ...(COFFEE_URL
        ? [
            h('span', { class: 'dot', 'aria-hidden': 'true' }, '·'),
            h('a', { class: 'link', href: COFFEE_URL, target: '_blank', rel: 'noopener' }, '☕ Buy me a coffee'),
          ]
        : []),
    );
  }

  private tick(): void {
    const text = formatCountdown(msUntilNextDay());
    document.querySelectorAll('[data-countdown]').forEach((el) => (el.textContent = text));
    const now = dayNumber();
    if (now !== this.today) {
      this.today = now;
      this.renderFooter();
      if (this.screen === 'home') this.showHome();
    }
  }

  toast(text: string): void {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout((t as unknown as { _t?: number })._t);
    (t as unknown as { _t?: number })._t = window.setTimeout(() => t.classList.remove('show'), 2200);
  }

  private setScreen(s: Screen): void {
    this.screen = s;
    document.body.dataset.screen = s;
  }

  // ------------------------------------------------------------------ home

  showHome(): void {
    this.setScreen('home');
    this.jettisonMode = false;
    const p = dailyPuzzle(this.today);
    const rule = puzzleRule(p);
    const done = save.daily[this.today];
    const inProgress = save.current && save.current.kind === 'daily' && save.current.id === this.today && !save.current.outcome;
    const stats = computeStats(save.daily, this.today);
    const unlimitedBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => this.startUnlimited() }, 'UNLIMITED');
    isUnlocked().then((ok) => {
      if (!ok) {
        unlimitedBtn.prepend(h('span', { class: 'btn-lock', html: icon('lock') }));
        unlimitedBtn.setAttribute('aria-label', 'Unlimited (locked)');
      }
    });
    this.scene.reset(p.hold, false);
    this.scene.setNight(0.1);
    this.scene.setTension(0);
    audio.setTension(0);
    $('#overlay').replaceChildren();

    const slots = h('div', { class: 'hold-icons', 'aria-hidden': 'true' });
    for (let i = 0; i < p.hold; i++) slots.append(h('span', { class: 'hold-icon' }));

    const primary = done
      ? h('button', { class: 'btn btn-big', type: 'button', onclick: () => this.showResult(p, this.recordVoyage(p, done), done, false) }, 'VIEW TODAY’S RESULT')
      : h('button', { class: 'btn btn-big', type: 'button', id: 'begin', onclick: () => this.startVoyage(p) }, inProgress ? 'CONTINUE LOADING' : 'BEGIN LOADING');

    $('#panel').replaceChildren(
      h(
        'div',
        { class: 'home' },
        h('p', { class: 'voyage-line' }, `VOYAGE #${p.id} · ${formatDayDate(p.id).toUpperCase()}`),
        h(
          'section',
          { class: 'manifest card', 'aria-label': "Today's manifest" },
          h('h2', { class: 'card-title' }, "TODAY'S MANIFEST"),
          h('p', { class: 'rule' }, rule.text),
          h('p', { class: 'rule-detail' }, rule.detail),
          h(
            'div',
            { class: 'manifest-grid' },
            h('div', { class: 'mf' }, h('span', { class: 'mf-label' }, 'LOAD LINE'), h('span', { class: 'mf-value accent' }, formatFull(p.target))),
            h('div', { class: 'mf' }, h('span', { class: 'mf-label' }, 'HOLD'), h('span', { class: 'mf-value' }, `${p.hold} containers`), slots),
          ),
        ),
        primary,
        done ? h('p', { class: 'next-line' }, 'Next voyage in ', h('span', { 'data-countdown': '' }, formatCountdown(msUntilNextDay()))) : null,
        h(
          'div',
          { class: 'home-buttons' },
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => this.modals.archive() }, 'ARCHIVE'),
          unlimitedBtn,
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => this.modals.stats() }, 'STATS'),
        ),
        h(
          'p',
          { class: 'streak' },
          h('span', { class: 'streak-flame', 'aria-hidden': 'true' }),
          stats.streak ? `${stats.streak}-day streak` : 'No streak yet: finish a voyage without sinking',
          stats.bestStreak > stats.streak ? ` · best ${stats.bestStreak}` : '',
        ),
      ),
    );
  }

  /** Opens a day from the archive: its result if already played, otherwise a fresh voyage. */
  openDay(n: number): void {
    if (this.busy) return;
    const kind = n === this.today ? 'daily' : 'archive';
    const p = dailyPuzzle(n, kind);
    const rec = save.daily[n] ?? save.archive[n];
    if (rec) this.showResult(p, this.recordVoyage(p, rec), rec, false);
    else this.startVoyage(p);
  }

  private async startUnlimited(): Promise<void> {
    if (!(await isUnlocked())) {
      this.modals.paywall(() => {
        this.toast('UNLIMITED UNLOCKED. FAIR WINDS!');
        this.startUnlimited();
      });
      return;
    }
    // Resume an unfinished practice voyage, otherwise roll a fresh one.
    const cur = save.current;
    const seed = cur && cur.kind === 'unlimited' && !cur.outcome ? cur.id : (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    save.practice.seed = seed;
    persist();
    this.startVoyage(unlimitedPuzzle(seed));
  }

  // ------------------------------------------------------------------ game

  private startVoyage(p: Puzzle, resume?: VoyageState): void {
    this.puzzle = p;
    const cur = save.current;
    const same = cur && cur.kind === p.kind && cur.id === p.id && !cur.outcome;
    this.voyage = resume ?? (same ? cur! : newVoyage(p));
    save.current = this.voyage;
    persist();
    this.busy = false;
    this.jettisonMode = false;
    this.setScreen('game');
    this.scene.reset(p.hold, true);
    const v = this.voyage;
    this.scene.restore(
      v.loaded.map((c) => ({ iso3: c, iso2: byIso3(c).iso2 })),
      totalOf(v.loaded) / p.target,
    );
    this.renderGame();
    this.updateGame();
    this.updateNight(true);
    requestAnimationFrame(() => this.input.focus({ preventScroll: true }));
  }

  private renderGame(): void {
    const p = this.puzzle;
    const rule = puzzleRule(p);
    const label = p.kind === 'unlimited' ? 'PRACTICE VOYAGE' : `VOYAGE #${p.id}${p.kind === 'archive' ? ' · ARCHIVE' : ''}`;

    this.input = h('input', {
      id: 'cargo-input',
      class: 'cargo-input',
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'words',
      spellcheck: 'false',
      placeholder: 'Type a country…',
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': 'false',
      'aria-controls': 'cargo-list',
      'aria-label': 'Country to load',
    });
    this.list = h('ul', { id: 'cargo-list', class: 'suggest', role: 'listbox', 'aria-label': 'Matching countries' });
    this.loadBtn = h('button', { class: 'btn btn-load', type: 'submit' }, 'LOAD');
    this.msg = h('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });
    this.cargo = h('div', { class: 'cargo-grid', role: 'list', 'aria-label': 'Cargo hold' });
    this.jetBtn = h('button', { class: 'btn btn-ghost btn-jet', type: 'button', onclick: () => this.toggleJettison() }, 'JETTISON');
    this.sailBtn = h('button', { class: 'btn btn-sail', type: 'button', onclick: () => this.setSail() }, 'SET SAIL');
    this.holdCount = h('span', { class: 'hold-count' });

    const form = h(
      'form',
      {
        class: 'load-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          this.submit();
        },
      },
      h('div', { class: 'combo' }, this.input, this.list),
      this.loadBtn,
    );

    this.input.addEventListener('input', () => {
      audio.play('type');
      this.refreshSuggestions();
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => setTimeout(() => this.closeSuggestions(), 150));

    $('#panel').replaceChildren(
      h(
        'div',
        { class: 'game' },
        h(
          'div',
          { class: 'game-head' },
          h('span', { class: 'voyage-tag' }, label),
          h('span', { class: 'rule-chip', title: rule.detail }, rule.text),
          this.holdCount,
        ),
        form,
        this.msg,
        this.cargo,
        h('div', { class: 'actions' }, this.jetBtn, this.sailBtn),
      ),
    );

    const overlay = $('#overlay');
    overlay.replaceChildren(
      h(
        'div',
        { class: 'hud' },
        h('div', { class: 'hud-chip' }, h('span', { class: 'hud-label' }, 'LOAD LINE'), h('span', { class: 'hud-val accent', id: 'hud-target' }, '')),
        h('div', { class: 'hud-chip right' }, h('span', { class: 'hud-label' }, 'CARGO'), h('span', { class: 'hud-val', id: 'hud-load' }, '')),
      ),
      h(
        'div',
        { class: 'gauge', id: 'gauge', role: 'meter', 'aria-label': 'Load against the load line', 'aria-valuemin': '0', 'aria-valuemax': '100' },
        h('div', { class: 'gauge-fill' }),
        h('div', { class: 'gauge-line' }),
      ),
    );
  }

  private updateGame(): void {
    if (this.screen !== 'game' || !this.cargo) return;
    const p = this.puzzle;
    const v = this.voyage;
    const total = totalOf(v.loaded);
    const ratio = total / p.target;
    this.holdCount.textContent = `HOLD ${v.loaded.length}/${p.hold}`;
    this.cargo.replaceChildren();
    for (let i = 0; i < p.hold; i++) {
      const iso = v.loaded[i];
      if (iso) {
        const c = byIso3(iso);
        const color = CARGO_COLORS[hashString(c.iso3) % CARGO_COLORS.length];
        const content = [
          flagElement(c.iso2, c.name),
          h('span', { class: 'cc-code' }, c.iso3),
          h('span', { class: 'cc-name' }, c.name),
          h('span', { class: 'cc-pop' }, this.fmt(c.population)),
        ];
        const card = this.jettisonMode
          ? h('button', { class: 'cargo-card filled throwable', type: 'button', role: 'listitem', style: `--cc:${color}`, 'aria-label': `Throw ${c.name} overboard`, onclick: () => this.doJettison(c.iso3) }, ...content)
          : h('div', { class: 'cargo-card filled', role: 'listitem', style: `--cc:${color}`, 'aria-label': `${c.name}, ${formatFull(c.population)} people` }, ...content);
        this.cargo.append(card);
      } else {
        this.cargo.append(h('div', { class: 'cargo-card empty', role: 'listitem', 'aria-label': 'Empty slot' }, h('span', {}, `SLOT ${i + 1}`)));
      }
    }
    const jetUsed = !!v.jettisoned;
    this.jetBtn.disabled = this.busy || jetUsed || v.loaded.length === 0;
    this.jetBtn.textContent = jetUsed ? 'JETTISONED' : this.jettisonMode ? 'CANCEL' : 'JETTISON ×1';
    this.jetBtn.classList.toggle('armed', this.jettisonMode);
    this.sailBtn.disabled = this.busy || v.loaded.length === 0;
    this.loadBtn.disabled = this.busy;
    this.input.disabled = this.busy;

    $('#hud-target').textContent = this.fmt(p.target);
    $('#hud-load').textContent = `${this.fmt(total)} · ${formatPercent(ratio)}`;
    const gauge = $('#gauge');
    gauge.style.setProperty('--fill', String(Math.min(ratio, 1.1) / 1.1));
    gauge.style.setProperty('--line', String(1 / 1.1));
    gauge.classList.toggle('near', ratio >= 0.9 && ratio < 0.98);
    gauge.classList.toggle('danger', ratio >= 0.98);
    gauge.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    gauge.setAttribute('aria-valuetext', `${formatPercent(ratio)} of the load line`);

    const tension = Math.max(0, Math.min(1, (ratio - 0.95) / 0.05));
    this.scene.setTension(tension);
    audio.setTension(tension);
  }

  private updateNight(instant = false): void {
    const v = this.voyage;
    const progress = (v.loaded.length + (v.jettisoned ? 1 : 0)) / (this.puzzle.hold + 1);
    this.scene.setNight(0.15 + 0.6 * progress, instant);
  }

  private say(text: string, kind: 'bad' | 'good' | '' = ''): void {
    this.msg.textContent = text;
    this.msg.className = `msg ${kind}`;
    if (kind === 'bad') {
      this.msg.classList.remove('shake');
      void this.msg.offsetWidth;
      this.msg.classList.add('shake');
    }
  }

  private refreshSuggestions(): void {
    const q = this.input.value;
    const hits = search(q, 6);
    this.suggestions = hits.map((s) => s.country);
    this.active = this.suggestions.length ? 0 : -1;
    this.list.replaceChildren(
      ...this.suggestions.map((c, i) =>
        h(
          'li',
          {
            id: `opt-${c.iso3}`,
            role: 'option',
            class: `opt${i === this.active ? ' active' : ''}${this.voyage.loaded.includes(c.iso3) ? ' aboard' : ''}`,
            'aria-selected': String(i === this.active),
            onmousedown: (e: Event) => {
              e.preventDefault();
              this.input.value = c.name;
              this.submit();
            },
          },
          flagElement(c.iso2, c.name),
          h('span', { class: 'opt-name' }, c.name),
          this.voyage.loaded.includes(c.iso3) ? h('span', { class: 'opt-tag' }, 'on deck') : null,
        ),
      ),
    );
    const open = this.suggestions.length > 0 && q.trim().length > 0;
    this.list.classList.toggle('open', open);
    this.input.setAttribute('aria-expanded', String(open));
    this.syncActive();
  }

  private syncActive(): void {
    [...this.list.children].forEach((li, i) => {
      li.classList.toggle('active', i === this.active);
      li.setAttribute('aria-selected', String(i === this.active));
    });
    const cur = this.suggestions[this.active];
    if (cur) this.input.setAttribute('aria-activedescendant', `opt-${cur.iso3}`);
    else this.input.removeAttribute('aria-activedescendant');
  }

  private closeSuggestions(): void {
    this.list?.classList.remove('open');
    this.input?.setAttribute('aria-expanded', 'false');
  }

  private onKey(e: KeyboardEvent): void {
    const open = this.list.classList.contains('open');
    if (e.key === 'ArrowDown' && this.suggestions.length) {
      e.preventDefault();
      if (!open) this.refreshSuggestions();
      this.active = (this.active + 1) % this.suggestions.length;
      this.syncActive();
    } else if (e.key === 'ArrowUp' && this.suggestions.length) {
      e.preventDefault();
      this.active = (this.active - 1 + this.suggestions.length) % this.suggestions.length;
      this.syncActive();
    } else if (e.key === 'Escape') {
      if (open) this.closeSuggestions();
      else if (this.jettisonMode) this.toggleJettison();
    } else if (e.key === 'Tab' && open && this.suggestions[this.active]) {
      e.preventDefault();
      this.input.value = this.suggestions[this.active].name;
      this.refreshSuggestions();
    }
  }

  private async submit(): Promise<void> {
    if (this.busy || this.voyage.outcome) return;
    const typed = this.input.value.trim();
    if (!typed) {
      this.say('Type a country name to load it.');
      return;
    }
    const open = this.list.classList.contains('open');
    const picked = open && this.suggestions[this.active] ? this.suggestions[this.active] : resolve(typed);
    this.closeSuggestions();
    if (!picked) {
      audio.play('reject');
      this.say(`No port called "${typed}" on our charts. Check the spelling?`, 'bad');
      return;
    }
    const res = tryLoad(this.voyage, this.puzzle, picked);
    if (!res.ok) {
      audio.play('reject');
      this.say(`Customs says no: ${res.reason}`, 'bad');
      return;
    }
    if (this.jettisonMode) this.jettisonMode = false;
    this.input.value = '';
    this.say(`Loading ${picked.name}…`);
    if (res.sunk) this.recordFinish('sunk');
    else persist();
    this.busy = true;
    this.updateGameCardsPending(picked);
    await this.scene.load({ iso3: picked.iso3, iso2: picked.iso2 });

    // Touchdown: reveal the weight.
    const p = this.puzzle;
    this.scene.setRatio(res.total / p.target);
    audio.play('reveal');
    this.popup(`+ ${formatFull(picked.population)}`, this.voyage.loaded.length - 1, res.sunk ? 'bad' : 'good');
    this.updateGame();
    this.updateNight();
    const r = res.total / p.target;
    if (res.sunk) this.say(`${picked.name} weighs ${formatFull(picked.population)}. That's over the line!`, 'bad');
    else if (r >= 0.98) this.say(`${picked.name}: ${formatFull(picked.population)}. Right on the line… careful now.`, 'good');
    else this.say(`${picked.name}: ${formatFull(picked.population)}. ${formatPercent(r)} loaded.`, 'good');

    if (res.sunk) {
      await sleep(this.reduced() ? 400 : 900);
      await this.finish('sunk');
      return;
    }
    if (res.full) {
      await sleep(900);
      this.say('Hold full. Setting sail!', 'good');
      await this.finish('sailed');
      return;
    }
    this.busy = false;
    this.updateGame();
    this.input.focus({ preventScroll: true });
  }

  /** While the crane works, show the new card without its weight. */
  private updateGameCardsPending(c: Country): void {
    this.updateGame();
    const cards = this.cargo.querySelectorAll('.cargo-card.filled');
    const card = cards[cards.length - 1];
    const pop = card?.querySelector('.cc-pop');
    if (pop) pop.textContent = '? ? ?';
    card?.setAttribute('aria-label', `${c.name}, weight not yet revealed`);
  }

  /** "+ 46,800,000" counting up beside the container that just landed. */
  private popup(text: string, slot: number, kind: 'good' | 'bad'): void {
    const pt = this.scene.slotPoint(Math.max(0, slot));
    const el = h('div', { class: `popup ${kind}`, style: `left:${(pt.x / 320) * 100}%;top:${(pt.y / 200) * 100}%` }, '');
    $('#overlay').append(el);
    const target = Number(text.replace(/[^\d]/g, ''));
    const sign = text.startsWith('-') || text.startsWith('−') ? '− ' : '+ ';
    const dur = this.reduced() ? 300 : 650;
    const t0 = performance.now();
    let lastTick = 0;
    const stepFn = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const eased = 1 - (1 - k) ** 3;
      el.textContent = sign + formatFull(Math.round(target * eased / 1000) * 1000);
      if (now - lastTick > 55 && k < 1) {
        audio.play('tick', k);
        lastTick = now;
      }
      if (k < 1) requestAnimationFrame(stepFn);
    };
    requestAnimationFrame(stepFn);
    setTimeout(() => el.remove(), 2600);
  }

  private toggleJettison(): void {
    if (this.busy || this.voyage.jettisoned || !this.voyage.loaded.length) return;
    audio.play('click');
    this.jettisonMode = !this.jettisonMode;
    this.say(this.jettisonMode ? 'Pick a container to throw overboard. You only get one!' : '');
    this.updateGame();
    if (this.jettisonMode) (this.cargo.querySelector('.throwable') as HTMLElement | null)?.focus();
  }

  private async doJettison(iso3: string): Promise<void> {
    if (this.busy) return;
    if (!jettison(this.voyage, iso3)) return;
    persist();
    this.jettisonMode = false;
    this.busy = true;
    const c = byIso3(iso3);
    this.updateGame();
    this.say(`Overboard goes ${c.name}! Splash.`);
    await this.scene.jettison(iso3);
    this.scene.setRatio(totalOf(this.voyage.loaded) / this.puzzle.target);
    this.popup(`− ${formatFull(c.population)}`, Math.max(0, this.voyage.loaded.length), 'bad');
    this.busy = false;
    this.updateGame();
    this.updateNight();
    this.input.focus({ preventScroll: true });
  }

  private async setSail(): Promise<void> {
    if (this.busy || !this.voyage.loaded.length || this.voyage.outcome) return;
    await this.finish('sailed');
  }

  /** Stores the outcome the moment it is decided, so a reload can't undo it. */
  private recordFinish(outcome: 'sunk' | 'sailed'): VoyageRecord {
    const v = this.voyage;
    const p = this.puzzle;
    v.outcome = outcome;
    const rec: VoyageRecord = {
      score: finalScore(v, p),
      sunk: outcome === 'sunk',
      loaded: v.loaded.slice(),
      jettisoned: v.jettisoned,
      total: totalOf(v.loaded),
      at: Date.now(),
    };
    if (p.kind === 'daily') save.daily[p.id] = rec;
    else if (p.kind === 'archive') save.archive[p.id] = rec;
    else {
      save.practice.played++;
      save.practice.best = Math.max(save.practice.best, rec.score);
    }
    save.current = null;
    persist();
    return rec;
  }

  private async finish(outcome: 'sunk' | 'sailed'): Promise<void> {
    this.busy = true;
    const rec = outcome === 'sunk' && this.voyage.outcome === 'sunk' ? this.currentRecord() : this.recordFinish(outcome);
    this.updateGame();
    if (outcome === 'sunk') {
      this.scene.setTension(0);
      audio.setTension(0);
      this.scene.setShowSlots(false);
      await this.scene.sink();
      this.showResult(this.puzzle, this.voyage, rec, true);
    } else {
      this.scene.setTension(0);
      audio.setTension(0);
      this.scene.setNight(0.85);
      const sailing = this.scene.sail(rec.score >= 1000);
      this.showResult(this.puzzle, this.voyage, rec, true);
      await sailing;
      this.scene.showGhost(this.ghostSpecs(this.puzzle), this.puzzle.optimal.total / this.puzzle.target);
    }
    this.busy = false;
  }

  private currentRecord(): VoyageRecord {
    const p = this.puzzle;
    const rec = p.kind === 'daily' ? save.daily[p.id] : p.kind === 'archive' ? save.archive[p.id] : undefined;
    return (
      rec ?? {
        score: 0,
        sunk: true,
        loaded: this.voyage.loaded.slice(),
        jettisoned: this.voyage.jettisoned,
        total: totalOf(this.voyage.loaded),
        at: Date.now(),
      }
    );
  }

  private ghostSpecs(p: Puzzle) {
    return p.optimal.iso3.map((c) => ({ iso3: c, iso2: byIso3(c).iso2 }));
  }

  private recordVoyage(p: Puzzle, rec: VoyageRecord): VoyageState {
    return { kind: p.kind, id: p.id, loaded: rec.loaded.slice(), jettisoned: rec.jettisoned, outcome: rec.sunk ? 'sunk' : 'sailed' };
  }

  // ------------------------------------------------------------------ result

  private showResult(p: Puzzle, v: VoyageState, rec: VoyageRecord, animate: boolean): void {
    this.puzzle = p;
    this.voyage = v;
    this.setScreen('result');
    const rank = rankFor(rec.score, rec.sunk);
    const ratio = rec.total / p.target;
    const best = p.optimal.total;

    if (!animate) {
      // Revisiting a finished voyage: set the stage without replaying it.
      this.scene.reset(p.hold, false);
      this.scene.setNight(0.85, true);
      if (rec.sunk) {
        this.scene.restore(v.loaded.map((c) => ({ iso3: c, iso2: byIso3(c).iso2 })), 0);
        this.scene.mode = 'underwater';
      } else {
        this.scene.restore([], 0);
        this.scene.setShipVisible(false);
      }
      this.scene.showGhost(this.ghostSpecs(p), best / p.target);
    } else if (rec.sunk) {
      this.scene.showGhost(this.ghostSpecs(p), best / p.target);
    }

    const overlay = $('#overlay');
    overlay.replaceChildren(h('div', { class: `ghost-label${animate && !rec.sunk ? '' : ' now'}` }, 'GHOST SHIP: THE BEST POSSIBLE LOAD'));
    if (rec.sunk) overlay.prepend(h('div', { class: 'sunk-banner' }, h('span', {}, 'SLEEPING WITH'), h('span', {}, 'THE FISHES')));

    const scoreEl = h('span', { class: 'score-num' }, animate ? '0' : String(rec.score));
    const title = p.kind === 'unlimited' ? 'PRACTICE VOYAGE' : `VOYAGE #${p.id}${p.kind === 'archive' ? ' · ARCHIVE' : ''}`;
    const youPct = Math.min(1, ratio);
    const bestPct = best / p.target;

    const cargoRows = [...v.loaded.map((c) => ({ c: byIso3(c), thrown: false })), ...(v.jettisoned ? [{ c: byIso3(v.jettisoned), thrown: true }] : [])];

    const shareBtn = h('button', { class: 'btn btn-big', type: 'button', onclick: () => this.share(p, rec) }, 'SHARE RESULT');
    const buttons = h('div', { class: 'result-buttons' }, shareBtn);
    if (p.kind === 'unlimited') buttons.append(h('button', { class: 'btn btn-lime', type: 'button', onclick: () => this.nextPractice() }, 'NEXT VOYAGE'));
    if (p.kind === 'archive') buttons.append(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => this.modals.archive() }, 'ARCHIVE'));
    buttons.append(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => this.showHome() }, 'HARBOUR'));

    const countryRow = (c: Country, extra?: string) =>
      h(
        'li',
        { class: `crow${extra ? ` ${extra}` : ''}` },
        flagElement(c.iso2, c.name),
        h('span', { class: 'crow-name' }, c.name),
        h('span', { class: 'crow-pop' }, formatFull(c.population)),
      );

    $('#panel').replaceChildren(
      h(
        'div',
        { class: `result${rec.sunk ? ' sunk' : ''}${rec.score >= 1000 ? ' perfect' : ''}`, style: `--rank:${rank.color}` },
        h('p', { class: 'voyage-line' }, title),
        h('h2', { class: 'rank-name' }, rank.name),
        h('p', { class: 'score' }, scoreEl, h('span', { class: 'score-of' }, ' / 1000')),
        h(
          'p',
          { class: 'result-line' },
          rec.sunk
            ? `Overloaded by ${formatFull(rec.total - p.target)}. The load line was ${formatFull(p.target)}.`
            : `You loaded ${formatFull(rec.total)} of ${formatFull(p.target)} (${formatPercent(ratio)}).`,
        ),
        h(
          'section',
          { class: 'card compare', 'aria-label': 'Your load compared with the best possible load' },
          h('h3', { class: 'card-title' }, 'YOUR LOAD vs THE BEST'),
          h(
            'div',
            { class: 'bar-row' },
            h('span', { class: 'bar-label' }, 'YOU'),
            h('div', { class: `bar${rec.sunk ? ' over' : ''}` }, h('div', { class: 'bar-fill you', style: `--w:${rec.sunk ? 1 : youPct}` })),
            h('span', { class: 'bar-val' }, rec.sunk ? 'SUNK' : formatPercent(ratio)),
          ),
          h(
            'div',
            { class: 'bar-row' },
            h('span', { class: 'bar-label' }, 'BEST'),
            h('div', { class: 'bar' }, h('div', { class: 'bar-fill best', style: `--w:${bestPct}` })),
            h('span', { class: 'bar-val' }, formatPercent(bestPct)),
          ),
          h('ul', { class: 'clist ghost' }, ...p.optimal.iso3.map((c) => countryRow(byIso3(c)))),
          h('p', { class: 'clist-total' }, `Best total ${formatFull(best)} · ${formatFull(p.target - best)} under the line`),
        ),
        cargoRows.length
          ? h(
              'section',
              { class: 'card' },
              h('h3', { class: 'card-title' }, 'YOUR CARGO'),
              h('ul', { class: 'clist' }, ...cargoRows.map(({ c, thrown }) => countryRow(c, thrown ? 'thrown' : ''))),
            )
          : null,
        buttons,
        p.kind !== 'unlimited' ? h('p', { class: 'next-line' }, 'Next voyage in ', h('span', { 'data-countdown': '' }, formatCountdown(msUntilNextDay()))) : null,
        cargoRows.length
          ? h(
              'section',
              { class: 'card portlog' },
              h('h3', { class: 'card-title' }, 'PORT LOG'),
              h('ul', { class: 'log' }, ...cargoRows.map(({ c }) => h('li', {}, h('strong', {}, `${c.name}. `), c.fact))),
            )
          : null,
      ),
    );

    if (animate) this.countUp(scoreEl, rec.score, rec);
    const panel = $('#panel');
    panel.scrollTop = 0;
  }

  private countUp(el: HTMLElement, score: number, rec: VoyageRecord): void {
    if (score === 0) {
      el.textContent = '0';
      return;
    }
    const dur = this.reduced() ? 500 : 1600;
    const t0 = performance.now() + 500;
    let last = -1;
    const step = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - t0) / dur));
      const v = Math.round(score * (1 - (1 - k) ** 2));
      if (v !== last && Math.floor(v / 25) !== Math.floor(last / 25)) audio.play('tick', v / 1000);
      last = v;
      el.textContent = String(v);
      if (k < 1) requestAnimationFrame(step);
      else {
        el.classList.add('landed');
        if (!rec.sunk) audio.play('fanfare', score >= 1000 ? 1 : 0);
      }
    };
    requestAnimationFrame(step);
  }

  private nextPractice(): void {
    save.practice.seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    persist();
    this.startVoyage(unlimitedPuzzle(save.practice.seed));
  }

  private async share(p: Puzzle, rec: VoyageRecord): Promise<void> {
    audio.play('click');
    const text = shareText({
      kind: p.kind,
      id: p.id,
      score: rec.score,
      sunk: rec.sunk,
      containers: rec.loaded.length,
      jettisoned: rec.jettisoned ? 1 : 0,
    });
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (coarse && navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      this.toast('Result copied to clipboard!');
    } catch {
      const ta = h('textarea', { class: 'sr-only' }, text);
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      this.toast(ok ? 'Result copied to clipboard!' : 'Copy failed. Your browser blocked the clipboard.');
    }
  }
}
