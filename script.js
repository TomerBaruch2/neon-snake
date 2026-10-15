'use strict';

// =====================================================================
// Pure game logic (no DOM) — grid-based, deterministic, unit-testable
// =====================================================================
const Logic = (() => {
  const GRID = 20;
  const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const DIFFICULTIES = {
    easy: { base: 160, min: 80 },
    normal: { base: 120, min: 60 },
    hard: { base: 85, min: 45 },
  };
  const FOODS_PER_LEVEL = 5;
  const GOLDEN_MS = 6000;
  const SPEEDUP = 0.92;

  const copy = cells => cells.map(c => ({ x: c.x, y: c.y }));
  const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;

  function createState(difficulty = 'normal', rng = Math.random) {
    const snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    const state = {
      grid: GRID,
      difficulty: DIFFICULTIES[difficulty] ? difficulty : 'normal',
      snake,
      prev: copy(snake),
      dir: 'right',
      queue: [],
      pendingGrowth: 0,
      food: null,
      golden: null,
      score: 0,
      foodsEaten: 0,
      level: 1,
      status: 'running',
      rng,
    };
    state.food = spawnCell(state);
    return state;
  }

  // Interval is derived from the level (never accumulated), so speed can't run away.
  function interval(state) {
    const d = DIFFICULTIES[state.difficulty];
    return Math.max(d.min, Math.round(d.base * Math.pow(SPEEDUP, state.level - 1)));
  }

  function freeCells(state) {
    const used = new Set(state.snake.map(c => c.y * GRID + c.x));
    if (state.food) used.add(state.food.y * GRID + state.food.x);
    if (state.golden) used.add(state.golden.y * GRID + state.golden.x);
    const cells = [];
    for (let i = 0; i < GRID * GRID; i++) if (!used.has(i)) cells.push({ x: i % GRID, y: Math.floor(i / GRID) });
    return cells;
  }

  function spawnCell(state) {
    const cells = freeCells(state);
    if (cells.length === 0) return null;
    return cells[Math.floor(state.rng() * cells.length)];
  }

  // Turns are queued (max 2) and validated against the last queued direction,
  // so fast double-taps can't reverse the snake into itself.
  function queueDirection(state, dir) {
    const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
    if (!DIRS[dir] || dir === last || dir === OPPOSITE[last] || state.queue.length >= 2) return false;
    state.queue.push(dir);
    return true;
  }

  function step(state) {
    if (state.status !== 'running') return [];
    const events = [];
    state.prev = copy(state.snake);
    if (state.queue.length) state.dir = state.queue.shift();
    const d = DIRS[state.dir];
    const head = { x: state.snake[0].x + d.x, y: state.snake[0].y + d.y };

    if (head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID) {
      state.status = 'over';
      return [{ type: 'wall' }];
    }
    // The tail cell is free this tick unless the snake is still growing.
    const body = state.pendingGrowth === 0 ? state.snake.slice(0, -1) : state.snake;
    if (body.some(c => same(c, head))) {
      state.status = 'over';
      return [{ type: 'self' }];
    }

    state.snake.unshift(head);
    let spawnGolden = false;
    if (same(head, state.food)) {
      state.score += 10;
      state.foodsEaten++;
      state.pendingGrowth += 1;
      state.food = null;
      events.push({ type: 'eat', x: head.x, y: head.y, points: 10 });
      if (state.foodsEaten % FOODS_PER_LEVEL === 0) {
        state.level++;
        spawnGolden = true;
        events.push({ type: 'levelup', level: state.level });
      }
    } else if (same(head, state.golden)) {
      state.score += 50;
      state.pendingGrowth += 2;
      state.golden = null;
      events.push({ type: 'golden', x: head.x, y: head.y, points: 50 });
    }
    if (state.pendingGrowth > 0) state.pendingGrowth--;
    else state.snake.pop();

    if (state.snake.length >= GRID * GRID) {
      state.status = 'won';
      state.food = null;
      state.golden = null;
      events.push({ type: 'win' });
      return events;
    }
    if (!state.food) state.food = spawnCell(state);
    if (spawnGolden) {
      const c = spawnCell(state);
      if (c) {
        state.golden = { x: c.x, y: c.y, remaining: GOLDEN_MS, total: GOLDEN_MS };
        events.push({ type: 'goldenSpawn' });
      }
    }
    return events;
  }

  // Only called while the game is actively running, so pausing freezes the bonus timer.
  function tickTimers(state, dt) {
    if (!state.golden) return [];
    state.golden.remaining -= dt;
    if (state.golden.remaining > 0) return [];
    state.golden = null;
    if (!state.food && state.status === 'running') state.food = spawnCell(state);
    return [{ type: 'goldenExpired' }];
  }

  return { GRID, DIRS, DIFFICULTIES, FOODS_PER_LEVEL, GOLDEN_MS, createState, interval, queueDirection, step, tickTimers, freeCells };
})();

// =====================================================================
// Browser UI
// =====================================================================
if (typeof document !== 'undefined' && document.getElementById('board')) (() => {
  const $ = id => document.getElementById(id);
  const GRID = Logic.GRID;

  // ---------- Storage (safe if localStorage is blocked) ----------
  const store = {
    get(k, fallback) {
      try { const v = localStorage.getItem('neonSnake.' + k); return v === null ? fallback : v; } catch (e) { return fallback; }
    },
    set(k, v) {
      try { localStorage.setItem('neonSnake.' + k, String(v)); } catch (e) { /* storage unavailable */ }
    },
  };

  // ---------- Sound (Web Audio, created only after a user gesture) ----------
  const Sound = (() => {
    let ac = null;
    let master = null;
    let muted = store.get('muted', '0') === '1';
    const log = [];

    function unlock() {
      if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.16;
        master.connect(ac.destination);
      } catch (e) { ac = null; }
    }

    function tone(freq, at, dur, type, endFreq, vol) {
      const t = ac.currentTime + at;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (endFreq !== freq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + dur + 0.02);
    }

    const arp = (notes, gap, dur, type, vol) => notes.forEach((f, i) => tone(f, i * gap, dur, type, f, vol));
    const SOUNDS = {
      click: () => tone(720, 0, 0.05, 'square', 720, 0.35),
      beep: () => tone(440, 0, 0.12, 'square', 440, 0.45),
      start: () => arp([523, 659, 784, 1047], 0.07, 0.12, 'square', 0.45),
      eat: () => tone(520, 0, 0.09, 'sine', 1040, 0.9),
      golden: () => arp([880, 1175, 1568, 2093], 0.06, 0.16, 'triangle', 0.8),
      levelup: () => arp([392, 523, 659, 784], 0.08, 0.14, 'square', 0.4),
      gameover: () => { tone(440, 0, 0.6, 'sawtooth', 70, 0.5); tone(220, 0.1, 0.6, 'square', 55, 0.25); },
      win: () => arp([523, 659, 784, 1047, 1319, 1568], 0.09, 0.2, 'triangle', 0.6),
    };

    function play(name) {
      if (muted || !ac) return;
      try { SOUNDS[name](); log.push(name); } catch (e) { /* audio failure must never break the game */ }
    }

    function toggle() {
      muted = !muted;
      store.set('muted', muted ? '1' : '0');
      return muted;
    }

    return { unlock, play, toggle, log, get muted() { return muted; } };
  })();

  // ---------- DOM refs ----------
  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  const bgCanvas = $('bg');
  const bg = bgCanvas.getContext('2d');
  const screens = { start: $('start-screen'), pause: $('pause-screen'), over: $('over-screen') };
  const helpScreen = $('help-screen');
  const countdownEl = $('countdown');
  const toastsEl = $('toasts');
  const scoreEl = $('score');
  const bestEl = $('best');
  const levelEl = $('level');
  const pauseBtn = $('pause-btn');

  // ---------- UI state ----------
  let mode = 'menu'; // menu | countdown | running | paused | over | won
  let state = null;
  let difficulty = Logic.DIFFICULTIES[store.get('difficulty', 'normal')] ? store.get('difficulty', 'normal') : 'normal';
  let best = parseInt(store.get('best', '0'), 10) || 0;
  let bestAtStart = 0;
  let recordAnnounced = false;
  let acc = 0;
  let countdownMs = 0;
  let countdownLabel = '';
  let lastTime = performance.now();
  let time = 0;
  let shake = 0;
  let particles = [];
  let floaters = [];
  let size = 480;
  let cell = 24;
  let dpr = 1;
  let gridCache = null;

  // ---------- Screens & HUD ----------
  function showScreen(name) {
    for (const key in screens) screens[key].classList.toggle('show', key === name);
  }

  function updateHud() {
    const score = state ? state.score : 0;
    scoreEl.textContent = score;
    bestEl.textContent = Math.max(best, score);
    levelEl.textContent = state ? state.level : 1;
    pauseBtn.textContent = mode === 'paused' ? 'RESUME' : 'PAUSE';
    pauseBtn.disabled = !(mode === 'running' || mode === 'paused');
    $('menu-best').textContent = best;
  }

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function toast(text, cls) {
    const el = document.createElement('div');
    el.className = 'toast ' + (cls || '');
    el.textContent = text;
    el.addEventListener('animationend', () => el.remove());
    toastsEl.appendChild(el);
  }

  function setDifficulty(d) {
    difficulty = d;
    store.set('difficulty', d);
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('selected', b.dataset.diff === d));
  }

  function renderSoundButtons() {
    document.querySelectorAll('.sound-toggle').forEach(b => {
      b.textContent = Sound.muted ? 'SOUND: OFF' : 'SOUND: ON';
      b.classList.toggle('off', Sound.muted);
    });
  }

  function toggleMute() {
    Sound.toggle();
    renderSoundButtons();
  }

  // ---------- Game flow ----------
  function startGame() {
    state = Logic.createState(difficulty);
    mode = 'countdown';
    countdownMs = 3000;
    countdownLabel = '';
    acc = 0;
    shake = 0;
    particles = [];
    floaters = [];
    toastsEl.textContent = '';
    bestAtStart = best;
    recordAnnounced = false;
    showScreen(null);
    closeHelp();
    updateHud();
  }

  function goToMenu() {
    mode = 'menu';
    state = null;
    countdownEl.textContent = '';
    showScreen('start');
    updateHud();
  }

  function pause() {
    if (mode !== 'running') return;
    mode = 'paused';
    showScreen('pause');
    updateHud();
  }

  function resume() {
    if (mode !== 'paused') return;
    mode = 'running';
    showScreen(null);
    closeHelp();
    updateHud();
  }

  function openHelp() {
    pause();
    helpScreen.classList.add('show');
  }

  function closeHelp() {
    helpScreen.classList.remove('show');
  }

  function endGame() {
    const won = state.status === 'won';
    mode = won ? 'won' : 'over';
    const isRecord = state.score > bestAtStart && state.score > 0;
    if (state.score > best) {
      best = state.score;
      store.set('best', best);
    }
    $('over-title').textContent = won ? 'YOU WIN!' : 'GAME OVER';
    $('over-sub').textContent = won ? 'You filled the entire board!' : 'You survived until Level ' + state.level + '!';
    $('over-score').textContent = state.score;
    $('over-best').textContent = best;
    $('over-foods').textContent = state.foodsEaten;
    $('over-level').textContent = state.level;
    $('over-record').hidden = !isRecord;
    screens.over.classList.toggle('won', won);
    if (won) Sound.play('win');
    else { Sound.play('gameover'); shake = 14; }
    showScreen('over');
    updateHud();
  }

  function handleEvents(events) {
    for (const e of events) {
      if (e.type === 'eat') {
        Sound.play('eat');
        burst(e.x, e.y, '#FF477E', 18);
        floaters.push({ x: e.x, y: e.y, text: '+10', color: '#FF8FB0', life: 0.9, max: 0.9 });
      } else if (e.type === 'golden') {
        Sound.play('golden');
        burst(e.x, e.y, '#FFD166', 34);
        floaters.push({ x: e.x, y: e.y, text: '+50', color: '#FFD166', life: 1.1, max: 1.1 });
        toast('+50 BONUS!', 'gold');
      } else if (e.type === 'levelup') {
        Sound.play('levelup');
        toast('LEVEL UP!', 'cyan');
        bump(levelEl.parentElement);
      }
    }
    if (events.some(e => e.points)) bump(scoreEl.parentElement);
    if (!recordAnnounced && bestAtStart > 0 && state.score > bestAtStart) {
      recordAnnounced = true;
      toast('NEW HIGH SCORE!', 'pink');
    }
    updateHud();
  }

  // ---------- Effects ----------
  function burst(gx, gy, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (1.5 + Math.random() * 5) * cell;
      const life = 0.35 + Math.random() * 0.45;
      particles.push({ x: gx + 0.5, y: gy + 0.5, vx: Math.cos(a) * s / cell, vy: Math.sin(a) * s / cell, life, max: life, color, r: 0.06 + Math.random() * 0.08 });
    }
  }

  function updateEffects(dt) {
    const s = dt / 1000;
    for (const p of particles) {
      p.life -= s;
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
    particles = particles.filter(p => p.life > 0);
    for (const f of floaters) { f.life -= s; f.y -= 1.4 * s; }
    floaters = floaters.filter(f => f.life > 0);
    shake = Math.max(0, shake - dt * 0.04);
  }

  // ---------- Rendering ----------
  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = rect.width;
    cell = size / GRID;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    gridCache = document.createElement('canvas');
    gridCache.width = canvas.width;
    gridCache.height = canvas.height;
    const g = gridCache.getContext('2d');
    g.scale(dpr, dpr);
    const grad = g.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.75);
    grad.addColorStop(0, '#0f1630');
    grad.addColorStop(1, '#090d1c');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    g.strokeStyle = 'rgba(0, 229, 255, 0.07)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < GRID; i++) {
      const p = Math.round(i * cell) + 0.5;
      g.moveTo(p, 0); g.lineTo(p, size);
      g.moveTo(0, p); g.lineTo(size, p);
    }
    g.stroke();

    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
  }

  const px = g => (g + 0.5) * cell;

  function drawFood(f) {
    const r = cell * 0.32 * (1 + 0.12 * Math.sin(time / 140));
    const x = px(f.x), y = px(f.y);
    ctx.save();
    ctx.shadowColor = '#FF477E';
    ctx.shadowBlur = 18;
    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    grad.addColorStop(0, '#FFC2D4');
    grad.addColorStop(0.45, '#FF477E');
    grad.addColorStop(1, '#C2185B');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#39FF88';
    ctx.lineWidth = Math.max(1.5, cell * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.85);
    ctx.quadraticCurveTo(x + r * 0.5, y - r * 1.5, x + r * 0.8, y - r * 1.25);
    ctx.stroke();
    ctx.restore();
  }

  function drawGolden(g) {
    const x = px(g.x), y = px(g.y);
    const frac = Math.max(0, g.remaining / g.total);
    const blink = g.remaining < 1500 ? 0.55 + 0.45 * Math.sin(time / 50) : 1;
    ctx.save();
    ctx.globalAlpha = blink;
    ctx.translate(x, y);
    ctx.shadowColor = '#FFD166';
    ctx.shadowBlur = 24;
    ctx.rotate(time / 600);
    const R = cell * 0.42 * (1 + 0.08 * Math.sin(time / 120));
    ctx.fillStyle = '#FFD166';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 === 0 ? R : R * 0.42;
      const a = (i / 8) * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFF6D6';
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = blink;
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.9)';
    ctx.lineWidth = Math.max(2, cell * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
    ctx.restore();
  }

  function drawSnake(alpha) {
    const dead = mode === 'over';
    const pts = state.snake.map((c, i) => {
      const p = state.prev[i] || state.prev[state.prev.length - 1];
      return { x: px(p.x + (c.x - p.x) * alpha), y: px(p.y + (c.y - p.y) * alpha) };
    });
    const head = pts[0], tail = pts[pts.length - 1];

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const grad = ctx.createLinearGradient(head.x, head.y, tail.x + 0.01, tail.y + 0.01);
    grad.addColorStop(0, dead ? '#FF477E' : '#39FF88');
    grad.addColorStop(1, dead ? '#7a2140' : '#00E5FF');
    ctx.strokeStyle = grad;
    ctx.shadowColor = dead ? '#FF477E' : '#39FF88';
    ctx.shadowBlur = 16;
    ctx.lineWidth = cell * 0.74;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = cell * 0.22;
    ctx.stroke();

    ctx.shadowColor = dead ? '#FF477E' : '#39FF88';
    ctx.shadowBlur = 20;
    ctx.fillStyle = dead ? '#FF7FA3' : '#8CFFC0';
    ctx.beginPath();
    ctx.arc(head.x, head.y, cell * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    const d = Logic.DIRS[state.dir];
    const perp = { x: -d.y, y: d.x };
    for (const side of [-1, 1]) {
      const ex = head.x + d.x * cell * 0.14 + perp.x * cell * 0.2 * side;
      const ey = head.y + d.y * cell * 0.14 + perp.y * cell * 0.2 * side;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex, ey, cell * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#080B16';
      ctx.beginPath();
      if (dead) {
        ctx.lineWidth = cell * 0.05;
        ctx.strokeStyle = '#080B16';
        const k = cell * 0.07;
        ctx.moveTo(ex - k, ey - k); ctx.lineTo(ex + k, ey + k);
        ctx.moveTo(ex + k, ey - k); ctx.lineTo(ex - k, ey + k);
        ctx.stroke();
      } else {
        ctx.arc(ex + d.x * cell * 0.04, ey + d.y * cell * 0.04, cell * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawEffects() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * cell, p.y * cell, p.r * cell, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(cell * 0.75)}px "Segoe UI", system-ui, sans-serif`;
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, f.life / f.max);
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 10;
      ctx.fillText(f.text, px(f.x), px(f.y) - cell * 0.6);
    }
    ctx.restore();
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.drawImage(gridCache, 0, 0, size, size);
    if (state) {
      if (state.food) drawFood(state.food);
      if (state.golden) drawGolden(state.golden);
      const alpha = mode === 'running' || mode === 'paused' ? Math.min(1, acc / Logic.interval(state)) : 1;
      drawSnake(alpha);
    }
    drawEffects();
    ctx.restore();
  }

  // ---------- Background stars ----------
  const stars = Array.from({ length: 70 }, () => ({
    x: Math.random(), y: Math.random(), r: 0.4 + Math.random() * 1.4,
    v: 0.004 + Math.random() * 0.012, tw: Math.random() * Math.PI * 2,
    c: Math.random() < 0.5 ? '57, 255, 136' : '0, 229, 255',
  }));

  function drawBackground(dt) {
    const w = bgCanvas.width, h = bgCanvas.height;
    bg.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.y -= s.v * dt / 1000;
      if (s.y < -0.02) { s.y = 1.02; s.x = Math.random(); }
      const a = 0.25 + 0.25 * Math.sin(time / 900 + s.tw);
      bg.fillStyle = `rgba(${s.c}, ${a})`;
      bg.beginPath();
      bg.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      bg.fill();
    }
  }

  // ---------- Main loop (one loop for the page's lifetime) ----------
  function updateCountdown(dt) {
    countdownMs -= dt;
    const label = countdownMs > 2000 ? '3' : countdownMs > 1000 ? '2' : countdownMs > 0 ? '1' : 'GO!';
    if (label !== countdownLabel) {
      countdownLabel = label;
      countdownEl.textContent = label;
      countdownEl.classList.remove('pop');
      void countdownEl.offsetWidth;
      countdownEl.classList.add('pop');
      Sound.play(label === 'GO!' ? 'start' : 'beep');
    }
    if (countdownMs <= 0) {
      mode = 'running';
      acc = 0;
      updateHud();
    }
  }

  function update(dt) {
    if (mode === 'countdown') {
      updateCountdown(dt);
    } else if (mode === 'running') {
      handleEvents(Logic.tickTimers(state, dt));
      acc += dt;
      let iv = Logic.interval(state);
      while (acc >= iv && mode === 'running') {
        acc -= iv;
        handleEvents(Logic.step(state));
        if (state.status !== 'running') { acc = 0; endGame(); }
        iv = Logic.interval(state);
      }
    }
    if (mode !== 'paused') updateEffects(dt);
  }

  function frame(now) {
    const dt = Math.min(Math.max(now - lastTime, 0), 100);
    lastTime = now;
    time += dt;
    update(dt);
    render();
    drawBackground(dt);
    requestAnimationFrame(frame);
  }

  // ---------- Input ----------
  const KEYS = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  };

  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    Sound.unlock();
    const code = e.code;
    const dir = KEYS[code];
    if (dir || code === 'Space' || code === 'Enter') e.preventDefault();

    if (helpScreen.classList.contains('show')) {
      if (code === 'Escape' || code === 'Space' || code === 'Enter' || code === 'KeyH') closeHelp();
      return;
    }
    if (dir) {
      if (mode === 'running') Logic.queueDirection(state, dir);
      return;
    }
    if (e.repeat) return;
    switch (code) {
      case 'Space':
      case 'KeyP':
        if (mode === 'running') pause();
        else if (mode === 'paused') resume();
        break;
      case 'Escape':
        if (mode === 'paused') resume();
        break;
      case 'KeyR':
        startGame();
        break;
      case 'Enter':
        if (mode === 'menu' || mode === 'over' || mode === 'won') startGame();
        break;
      case 'KeyM':
        toggleMute();
        break;
      case 'KeyH':
        openHelp();
        break;
    }
  });

  window.addEventListener('pointerdown', () => Sound.unlock());
  document.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    Sound.unlock();
    Sound.play('click');
    btn.blur();
  });

  $('start-btn').addEventListener('click', startGame);
  $('again-btn').addEventListener('click', startGame);
  $('menu-btn').addEventListener('click', goToMenu);
  $('resume-btn').addEventListener('click', resume);
  pauseBtn.addEventListener('click', () => (mode === 'paused' ? resume() : pause()));
  $('help-btn').addEventListener('click', openHelp);
  $('help-close').addEventListener('click', closeHelp);
  document.querySelectorAll('.sound-toggle').forEach(b => b.addEventListener('click', toggleMute));
  document.querySelectorAll('.diff-btn').forEach(b => b.addEventListener('click', () => setDifficulty(b.dataset.diff)));

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);
  window.addEventListener('resize', resize);

  // ---------- Boot ----------
  setDifficulty(difficulty);
  renderSoundButtons();
  resize();
  goToMenu();
  requestAnimationFrame(frame);

  // Read-only hooks for the automated test page (tests/test.html).
  window.__neon = {
    get state() { return state; },
    get mode() { return mode; },
    get sounds() { return Sound.log; },
    get muted() { return Sound.muted; },
  };
})();
