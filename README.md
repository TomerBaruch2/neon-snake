# NEON SNAKE

**Eat. Grow. Survive.**

A modern, neon arcade version of classic Snake that runs entirely in the browser — plain HTML, CSS and vanilla JavaScript. No server, no build step, no libraries, no accounts.

**Play it live:** https://tomerbaruch2.github.io/neon-snake/

## Features

- Smooth, glowing neon snake with eyes that follow its direction
- Three difficulty levels: Easy (160 ms/move), Normal (120 ms), Hard (85 ms)
- Levels: every 5 foods you level up and the snake gets faster (with a safe minimum speed)
- Golden bonus star after every 5 foods — 6 seconds to grab it for **+50** and 2 extra segments
- 3-2-1-GO countdown, pause/resume, game over and win screens
- High score, difficulty and sound preference saved in your browser (localStorage)
- Arcade sound effects generated live with the Web Audio API (no audio files), with mute
- Particle bursts, floating +10/+50, "LEVEL UP!" and "NEW HIGH SCORE!" pop-ups
- Fits on a 1366×768 laptop screen without scrolling

## How to play

Guide the snake to the pink apples. Each apple is worth 10 points and makes you one segment longer.
Don't hit the walls or your own body. Fill the whole 20×20 board to win.

### Keyboard controls

| Key | Action |
| --- | --- |
| ↑ ↓ ← → or W A S D | Move |
| Space or P | Pause / resume |
| R | Restart |
| M | Mute / unmute |
| Enter | Start from the menu / play again |
| H | How to play |

## Run it locally

Download or clone the repository and open `index.html` in any modern desktop browser. That's it.

```bash
git clone https://github.com/TomerBaruch2/neon-snake.git
cd neon-snake
start index.html      # Windows (macOS: open index.html)
```

## Tests

`tests/test.html` contains 27 game-logic unit tests and 36 end-to-end browser tests (controls, pausing, timers, high-score persistence, screen fit and more). Serve the folder (for example `python -m http.server`) and open `http://localhost:8000/tests/test.html`.

## Project structure

```
index.html   page layout and overlay screens
style.css    neon theme and animations
script.js    game logic (pure, testable) + rendering, input, sound and UI
tests/       automated test page
```

## Credits

Built with an AI coding agent (Claude Code) as part of the **Hebrew University Programming Lab**.
