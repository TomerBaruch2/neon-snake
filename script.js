'use strict';

// ---------- Pure game logic (no DOM) ----------
const Logic = (() => {
  const GRID = 20;
  const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  function createState(rng = Math.random) {
    const state = {
      grid: GRID,
      snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }],
      dir: 'right',
      queue: [],
      pendingGrowth: 0,
      food: null,
      score: 0,
      foodsEaten: 0,
      status: 'running',
      rng,
    };
    state.food = spawnCell(state);
    return state;
  }

  function freeCells(state) {
    const used = new Set(state.snake.map(c => c.y * GRID + c.x));
    if (state.food) used.add(state.food.y * GRID + state.food.x);
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
    if (dir === last || dir === OPPOSITE[last] || state.queue.length >= 2) return false;
    state.queue.push(dir);
    return true;
  }

  function step(state) {
    if (state.status !== 'running') return [];
    const events = [];
    if (state.queue.length) state.dir = state.queue.shift();
    const d = DIRS[state.dir];
    const head = { x: state.snake[0].x + d.x, y: state.snake[0].y + d.y };

    if (head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID) {
      state.status = 'over';
      return ['wall'];
    }
    // The tail cell is free this tick unless the snake is still growing.
    const tailMoves = state.pendingGrowth === 0;
    const body = tailMoves ? state.snake.slice(0, -1) : state.snake;
    if (body.some(c => c.x === head.x && c.y === head.y)) {
      state.status = 'over';
      return ['self'];
    }

    state.snake.unshift(head);
    if (state.food && head.x === state.food.x && head.y === state.food.y) {
      state.score += 10;
      state.foodsEaten++;
      state.pendingGrowth += 1;
      state.food = null;
      events.push('eat');
    }
    if (state.pendingGrowth > 0) state.pendingGrowth--;
    else state.snake.pop();

    if (state.snake.length >= GRID * GRID) {
      state.status = 'won';
      events.push('win');
      return events;
    }
    if (!state.food) state.food = spawnCell(state);
    return events;
  }

  return { GRID, createState, queueDirection, step, freeCells };
})();

// ---------- Browser UI ----------
if (typeof document !== 'undefined' && document.getElementById('board')) {
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const CELL = canvas.width / Logic.GRID;
  const overlay = document.getElementById('overlay');
  const scoreEl = document.getElementById('score');
  const TICK = 120;

  let state = null;
  let acc = 0;
  let lastTime = performance.now();

  const KEYS = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  };

  function start() {
    state = Logic.createState();
    acc = 0;
    overlay.classList.add('hidden');
  }

  function showGameOver() {
    document.getElementById('overlay-title').textContent = state.status === 'won' ? 'YOU WIN!' : 'GAME OVER';
    document.getElementById('overlay-text').textContent = 'Score: ' + state.score;
    document.getElementById('start-btn').textContent = 'PLAY AGAIN';
    overlay.classList.remove('hidden');
  }

  document.getElementById('start-btn').addEventListener('click', start);
  window.addEventListener('keydown', e => {
    if (e.code in KEYS || e.code === 'Space') e.preventDefault();
    if (e.code === 'KeyR') { start(); return; }
    if (state && state.status === 'running' && KEYS[e.code]) Logic.queueDirection(state, KEYS[e.code]);
  });

  function draw() {
    ctx.fillStyle = '#0d1224';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!state) return;
    if (state.food) {
      ctx.fillStyle = '#FF477E';
      ctx.beginPath();
      ctx.arc((state.food.x + 0.5) * CELL, (state.food.y + 0.5) * CELL, CELL * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    state.snake.forEach((c, i) => {
      ctx.fillStyle = i === 0 ? '#9dffc6' : '#39FF88';
      ctx.fillRect(c.x * CELL + 1, c.y * CELL + 1, CELL - 2, CELL - 2);
    });
  }

  // Single loop for the whole page lifetime; restarting only swaps `state`.
  function frame(now) {
    const dt = Math.min(now - lastTime, 250);
    lastTime = now;
    if (state && state.status === 'running') {
      acc += dt;
      while (acc >= TICK && state.status === 'running') {
        acc -= TICK;
        Logic.step(state);
        scoreEl.textContent = state.score;
        if (state.status !== 'running') showGameOver();
      }
    }
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.__neon = { get state() { return state; }, start };
}
