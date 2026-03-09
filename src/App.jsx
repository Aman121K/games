import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DIRS = ['up', 'right', 'down', 'left'];
const VEC = {
  up: [-1, 0],
  right: [0, 1],
  down: [1, 0],
  left: [0, -1],
};
const ROTATION = {
  right: 0,
  down: 90,
  left: 180,
  up: 270,
};

const STORAGE_USERS = 'arrow_users_v1';
const STORAGE_LEADERBOARD = 'arrow_leaderboard_v1';
const STORAGE_SESSION = 'arrow_session_user_v1';
const TOTAL_LEVELS = 200;

function getLevelMeta(levelNumber) {
  const isArrow = levelNumber % 2 === 1;
  return {
    id: levelNumber,
    type: isArrow ? 'arrow' : 'math',
    title: isArrow ? `Arrow Escape ${levelNumber}` : `Math Sprint ${levelNumber}`,
  };
}

function inBounds(r, c, size) {
  return r >= 0 && c >= 0 && r < size && c < size;
}

function rayClear(board, r, c, dir) {
  const size = board.length;
  const [dr, dc] = VEC[dir];
  let nr = r + dr;
  let nc = c + dc;
  while (inBounds(nr, nc, size)) {
    if (board[nr][nc]) return false;
    nr += dr;
    nc += dc;
  }
  return true;
}

function countBlocks(board) {
  let n = 0;
  for (let r = 0; r < board.length; r += 1) {
    for (let c = 0; c < board.length; c += 1) {
      if (board[r][c]) n += 1;
    }
  }
  return n;
}

function getCandidates(board) {
  const size = board.length;
  const out = [];
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (board[r][c]) continue;
      for (const dir of DIRS) {
        if (rayClear(board, r, c, dir)) {
          out.push({ r, c, dir });
        }
      }
    }
  }
  return out;
}

function generateArrowLevel(levelNumber) {
  const tier = Math.floor((levelNumber - 1) / 20);
  const size = Math.min(10, 5 + tier);
  const board = Array.from({ length: size }, () => Array(size).fill(null));
  const density = Math.min(0.9, 0.55 + levelNumber * 0.0024);
  const target = Math.floor(size * size * density);

  let placed = 0;
  let safety = size * size * 24;
  while (placed < target && safety > 0) {
    safety -= 1;
    const candidates = getCandidates(board);
    if (!candidates.length) break;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    board[pick.r][pick.c] = {
      id: `${levelNumber}-${placed + 1}-${Math.random().toString(36).slice(2, 8)}`,
      dir: pick.dir,
    };
    placed += 1;
  }

  return {
    levelNumber,
    board,
    total: countBlocks(board),
    hearts: levelNumber > 120 ? 2 : 3,
    timeLeft: Math.max(20, 48 - Math.floor(levelNumber / 7)),
    blockedCell: '',
    flying: [],
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeQuestion(levelNumber) {
  const difficulty = Math.floor(levelNumber / 10);
  const baseMin = 2 + difficulty;
  const baseMax = 12 + difficulty * 6;
  let a = randomInt(baseMin, baseMax);
  let b = randomInt(baseMin, baseMax);
  const opSet = ['+', '-', '*'];
  if (levelNumber >= 30) opSet.push('/');
  if (levelNumber >= 80) opSet.push('^');
  const op = opSet[randomInt(0, opSet.length - 1)];

  let answer = 0;
  if (op === '+') answer = a + b;
  if (op === '-') answer = a - b;
  if (op === '*') answer = a * b;
  if (op === '/') {
    b = randomInt(2, Math.min(12 + difficulty, 18));
    answer = randomInt(2 + Math.floor(difficulty / 2), 10 + difficulty);
    a = b * answer;
  }
  if (op === '^') {
    a = randomInt(2, 4);
    b = randomInt(2, levelNumber >= 130 ? 5 : 4);
    answer = a ** b;
  }

  const choices = new Set([answer]);
  while (choices.size < 4) {
    const noiseRange = Math.max(10, Math.floor(Math.abs(answer) * 0.25));
    const noise = randomInt(-noiseRange, noiseRange);
    if (noise === 0) continue;
    choices.add(answer + noise);
  }

  const options = Array.from(choices).sort(() => Math.random() - 0.5);
  return {
    prompt: `${a} ${op} ${b}`,
    answer,
    options,
  };
}

function generateMathLevel(levelNumber) {
  const totalQuestions = Math.min(14, 5 + Math.floor(levelNumber / 15));
  const questions = Array.from({ length: totalQuestions }, () => makeQuestion(levelNumber));
  return {
    levelNumber,
    questions,
    index: 0,
    solved: 0,
    timeLeft: Math.max(24, 52 - Math.floor(levelNumber / 6)),
    wrong: 0,
  };
}

function ArrowIcon({ dir, className = 'arrow-icon' }) {
  return (
    <svg className={className} viewBox="0 0 100 100" style={{ transform: `rotate(${ROTATION[dir]}deg)` }} aria-hidden="true">
      <path d="M18 50 H64" fill="none" stroke="#1f242e" strokeWidth="7" strokeLinecap="round" />
      <path d="M62 34 L88 50 L62 66 Z" fill="#1f242e" />
      <path d="M12 42 L22 50 L12 58 Z" fill="#1f242e" opacity="0.88" />
    </svg>
  );
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export default function App() {
  const [users, setUsers] = useState(() => loadJson(STORAGE_USERS, []));
  const [leaderboard, setLeaderboard] = useState(() => loadJson(STORAGE_LEADERBOARD, []));
  const [sessionUser, setSessionUser] = useState(() => localStorage.getItem(STORAGE_SESSION) || '');
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authMsg, setAuthMsg] = useState('');

  const [score, setScore] = useState(0);
  const [campaignIndex, setCampaignIndex] = useState(0);
  const [phase, setPhase] = useState('playing');
  const [status, setStatus] = useState('Welcome. Clear level 1 to start climbing leaderboard.');
  const advancingRef = useRef(false);

  const [arrowState, setArrowState] = useState(() => generateArrowLevel(1));
  const [mathState, setMathState] = useState(() => generateMathLevel(2));

  useEffect(() => {
    localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem(STORAGE_LEADERBOARD, JSON.stringify(leaderboard));
  }, [leaderboard]);

  const upsertLeaderboard = useCallback(
    (username, nextScore) => {
      if (!username) return;
      setLeaderboard((prev) => {
        const found = prev.find((x) => x.username === username);
        let next;
        if (found) {
          next = prev.map((x) =>
            x.username === username
              ? {
                  ...x,
                  score: nextScore,
                  bestScore: Math.max(x.bestScore || 0, nextScore),
                }
              : x
          );
        } else {
          next = [...prev, { username, score: nextScore, bestScore: nextScore }];
        }
        return next.sort((a, b) => b.score - a.score);
      });
    },
    []
  );

  useEffect(() => {
    if (!sessionUser) return;
    upsertLeaderboard(sessionUser, score);
  }, [score, sessionUser, upsertLeaderboard]);

  const playerRank = useMemo(() => {
    if (!sessionUser) return null;
    const idx = leaderboard.findIndex((x) => x.username === sessionUser);
    return idx === -1 ? null : idx + 1;
  }, [leaderboard, sessionUser]);

  const levelNumber = campaignIndex + 1;
  const currentLevel = getLevelMeta(levelNumber);
  const isLoggedIn = Boolean(sessionUser);

  useEffect(() => {
    if (!isLoggedIn || phase !== 'playing') return undefined;

    const timer = setInterval(() => {
      if (currentLevel.type === 'arrow') {
        setArrowState((prev) => {
          const nextTime = +(prev.timeLeft - 0.1).toFixed(1);
          if (nextTime <= 0) {
            setPhase('failed');
            setStatus('Time up on this arrow level. Retry to continue campaign.');
            return { ...prev, timeLeft: 0 };
          }
          return { ...prev, timeLeft: nextTime };
        });
      } else {
        setMathState((prev) => {
          const nextTime = +(prev.timeLeft - 0.1).toFixed(1);
          if (nextTime <= 0) {
            setPhase('failed');
            setStatus('Time up on this math level. Retry and move faster.');
            return { ...prev, timeLeft: 0 };
          }
          return { ...prev, timeLeft: nextTime };
        });
      }
    }, 100);

    return () => clearInterval(timer);
  }, [currentLevel.type, isLoggedIn, phase]);

  const startLevelByIndex = useCallback((idx) => {
    if (idx < 0 || idx >= TOTAL_LEVELS) return;
    const level = getLevelMeta(idx + 1);

    if (level.type === 'arrow') {
      setArrowState(generateArrowLevel(level.id));
    } else {
      setMathState(generateMathLevel(level.id));
    }

    setPhase('playing');
    setStatus(`Level ${level.id}: ${level.title}.`);
  }, []);

  const nextLevel = useCallback(() => {
    if (phase !== 'cleared' || advancingRef.current) return;
    advancingRef.current = true;

    setCampaignIndex((prev) => {
      if (prev >= TOTAL_LEVELS - 1) {
        setPhase('campaign_done');
        setStatus('Campaign complete. Great run. Play again to improve rank.');
        setScore((current) => current + 300);
        advancingRef.current = false;
        return prev;
      }
      const nextIdx = prev + 1;
      queueMicrotask(() => {
        startLevelByIndex(nextIdx);
        advancingRef.current = false;
      });
      return nextIdx;
    });
  }, [phase, startLevelByIndex]);

  const resetCampaign = useCallback(() => {
    setScore(0);
    setCampaignIndex(0);
    startLevelByIndex(0);
  }, [startLevelByIndex]);

  const handleAuth = useCallback(
    (e) => {
      e.preventDefault();
      const username = authForm.username.trim();
      const password = authForm.password.trim();

      if (username.length < 3 || password.length < 3) {
        setAuthMsg('Username and password must be at least 3 characters.');
        return;
      }

      if (authMode === 'register') {
        if (users.find((u) => u.username === username)) {
          setAuthMsg('User already exists. Please login.');
          return;
        }
        const nextUsers = [...users, { username, password }];
        setUsers(nextUsers);
        setSessionUser(username);
        localStorage.setItem(STORAGE_SESSION, username);
        setAuthMsg('Account created. You are now logged in.');
        setScore(0);
        setCampaignIndex(0);
        startLevelByIndex(0);
        return;
      }

      const found = users.find((u) => u.username === username && u.password === password);
      if (!found) {
        setAuthMsg('Invalid credentials.');
        return;
      }

      setSessionUser(username);
      localStorage.setItem(STORAGE_SESSION, username);
      setAuthMsg('Login successful.');
      const existing = leaderboard.find((x) => x.username === username);
      setScore(existing?.score || 0);
      setCampaignIndex(0);
      startLevelByIndex(0);
    },
    [authForm.password, authForm.username, authMode, leaderboard, startLevelByIndex, users]
  );

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_SESSION);
    setSessionUser('');
    setPhase('playing');
  }, []);

  const clickArrow = useCallback(
    (r, c) => {
      if (phase !== 'playing') return;
      const cell = arrowState.board[r][c];
      if (!cell) return;

      if (!rayClear(arrowState.board, r, c, cell.dir)) {
        setArrowState((prev) => ({ ...prev, hearts: Math.max(0, prev.hearts - 1), blockedCell: `${r}-${c}` }));
        setTimeout(() => {
          setArrowState((prev) => ({ ...prev, blockedCell: '' }));
        }, 220);
        setStatus('Blocked arrow. Heart -1.');
        return;
      }

      setArrowState((prev) => {
        const nextBoard = prev.board.map((row) => [...row]);
        nextBoard[r][c] = null;
        const updatedFlying = [...prev.flying, { id: cell.id, r, c, dir: cell.dir }];
        return { ...prev, board: nextBoard, flying: updatedFlying };
      });

      setTimeout(() => {
        setArrowState((prev) => ({ ...prev, flying: prev.flying.filter((x) => x.id !== cell.id) }));
      }, 320);

      setScore((prev) => prev + 35);
      setStatus('Great move.');
    },
    [arrowState.board, phase]
  );

  useEffect(() => {
    if (currentLevel.type !== 'arrow' || phase !== 'playing') return;

    const left = countBlocks(arrowState.board);
    if (left === 0) {
      const bonus = 180 + Math.floor(arrowState.timeLeft * 5) + arrowState.hearts * 40;
      setScore((prev) => prev + bonus);
      setPhase('cleared');
      setStatus(`Arrow level clear. Bonus +${bonus}.`);
      return;
    }

    if (arrowState.hearts <= 0) {
      setPhase('failed');
      setStatus("You're out of hearts. Retry this level.");
    }
  }, [arrowState.board, arrowState.hearts, arrowState.timeLeft, currentLevel.type, phase]);

  const mathQuestion = useMemo(() => {
    if (currentLevel.type !== 'math') return null;
    return mathState.questions[mathState.index] || null;
  }, [currentLevel.type, mathState.index, mathState.questions]);

  const answerMath = useCallback(
    (value) => {
      if (phase !== 'playing' || currentLevel.type !== 'math' || !mathQuestion) return;

      if (value === mathQuestion.answer) {
        const nextIndex = mathState.index + 1;
        const gain = 50;
        setScore((prev) => prev + gain);

        if (nextIndex >= mathState.questions.length) {
          const bonus = 220 + Math.floor(mathState.timeLeft * 4);
          setScore((prev) => prev + bonus);
          setMathState((prev) => ({ ...prev, solved: prev.solved + 1 }));
          setPhase('cleared');
          setStatus(`Math level clear. Bonus +${bonus}.`);
          return;
        }

        setMathState((prev) => ({ ...prev, index: nextIndex, solved: prev.solved + 1 }));
        setStatus('Correct answer. Keep going.');
      } else {
        setMathState((prev) => ({ ...prev, wrong: prev.wrong + 1, timeLeft: Math.max(0, +(prev.timeLeft - 3).toFixed(1)) }));
        setStatus('Wrong answer. Time penalty -3s.');
      }
    },
    [currentLevel.type, mathQuestion, mathState.index, mathState.questions.length, mathState.timeLeft, phase]
  );

  const retryCurrent = useCallback(() => {
    startLevelByIndex(campaignIndex);
  }, [campaignIndex, startLevelByIndex]);

  if (!isLoggedIn) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Arrow & Math Challenge</h1>
          <p>Login to play, track rank, and climb the leaderboard.</p>

          <div className="auth-toggle">
            <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Login</button>
            <button className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>Register</button>
          </div>

          <form onSubmit={handleAuth} className="auth-form">
            <input
              type="text"
              placeholder="Username"
              value={authForm.username}
              onChange={(e) => setAuthForm((prev) => ({ ...prev, username: e.target.value }))}
            />
            <input
              type="password"
              placeholder="Password"
              value={authForm.password}
              onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
            />
            <button type="submit">{authMode === 'login' ? 'Login & Play' : 'Create Account'}</button>
          </form>

          <p className="auth-msg">{authMsg || 'Use any username/password for local demo auth.'}</p>
        </div>
      </div>
    );
  }

  const arrowBlocksLeft = countBlocks(arrowState.board);
  const isOverlayOpen = phase === 'cleared' || phase === 'failed' || phase === 'campaign_done';
  const levelProgress = currentLevel.type === 'arrow' ? `${arrowState.total - arrowBlocksLeft}/${arrowState.total}` : `${mathState.solved}/${mathState.questions.length}`;
  const timerValue = currentLevel.type === 'arrow' ? arrowState.timeLeft : mathState.timeLeft;
  const canGoNext = phase === 'cleared';

  return (
    <div className="app-shell">
      <main className="play-area">
        <header className="hud-bar">
          <div className="hud-pill progress-pill">
            <span className="hud-arrow">↑</span>
            <strong>{levelProgress}</strong>
          </div>
          <div className="hud-center">
            <small>LV.{currentLevel.id}</small>
            <div className="hud-hearts">{'❤'.repeat(Math.max(1, arrowState.hearts))}{'♡'.repeat(Math.max(0, 3 - arrowState.hearts))}</div>
          </div>
          <div className="hud-pill">
            <strong>{timerValue.toFixed(1)}s</strong>
          </div>
        </header>

        <section className={`board-panel ${isOverlayOpen ? 'overlay-open' : ''}`}>
          <div className="level-head">
            <h3>{currentLevel.title}</h3>
            <p>{phase === 'playing' && currentLevel.type === 'arrow' ? 'Arrow Exit style: tap only arrows that have a clear path.' : status}</p>
          </div>

          {currentLevel.type === 'arrow' && (
            <div className="arrow-board" style={{ gridTemplateColumns: `repeat(${arrowState.board.length}, 1fr)` }}>
              {arrowState.board.map((row, r) =>
                row.map((cell, c) => (
                  <button
                    key={`${r}-${c}`}
                    className={`tile ${!cell ? 'empty' : ''} ${arrowState.blockedCell === `${r}-${c}` ? 'blocked' : ''}`}
                    disabled={!cell || phase !== 'playing'}
                    onClick={() => clickArrow(r, c)}
                  >
                    {cell ? <ArrowIcon dir={cell.dir} /> : ''}
                  </button>
                ))
              )}

              {arrowState.flying.map((f) => (
                <span key={f.id} className={`fly fly-${f.dir}`} style={{ gridColumn: f.c + 1, gridRow: f.r + 1 }}>
                  <ArrowIcon dir={f.dir} className="arrow-icon fly-icon" />
                </span>
              ))}
            </div>
          )}

          {currentLevel.type === 'math' && mathQuestion && (
            <div className="math-wrap">
              <div className="math-card">
                <p>Solve this</p>
                <h4>{mathQuestion.prompt}</h4>
              </div>
              <div className="math-options">
                {mathQuestion.options.map((opt) => (
                  <button key={opt} onClick={() => answerMath(opt)} disabled={phase !== 'playing'}>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {phase === 'cleared' && (
            <div className="overlay success">
              <div className="overlay-card">
                <h4>Level Cleared</h4>
                <p>Great work. Continue to next challenge.</p>
                <button onClick={nextLevel} disabled={!canGoNext}>Go Next</button>
              </div>
            </div>
          )}

          {phase === 'failed' && (
            <div className="overlay fail">
              <div className="overlay-card">
                <h4>Level Failed</h4>
                <p>{status}</p>
                <div className="overlay-actions">
                  <button onClick={retryCurrent}>Retry</button>
                  <button className="ghost light" onClick={resetCampaign}>Restart Campaign</button>
                </div>
              </div>
            </div>
          )}

          {phase === 'campaign_done' && (
            <div className="overlay success">
              <div className="overlay-card">
                <h4>Campaign Complete</h4>
                <p>You finished all {TOTAL_LEVELS} levels. Final score: {score}.</p>
                <button onClick={resetCampaign}>Play Again</button>
              </div>
            </div>
          )}
        </section>

        <div className="tool-row">
          <button onClick={retryCurrent}>Retry</button>
          <button onClick={nextLevel} disabled={!canGoNext}>Next</button>
          <button className="ghost" onClick={logout}>Logout</button>
        </div>

        <section className="info-strip">
          <article className="mini-stat"><span>Player</span><strong>{sessionUser}</strong></article>
          <article className="mini-stat"><span>Score</span><strong>{score}</strong></article>
          <article className="mini-stat"><span>Rank</span><strong>{playerRank ? `#${playerRank}` : '--'}</strong></article>
          <article className="mini-stat"><span>Mode</span><strong>{currentLevel.type.toUpperCase()}</strong></article>
        </section>

        <aside className="leaderboard-sheet">
          <h3>Leaderboard</h3>
          <div className="leader-list">
            {leaderboard.slice(0, 10).map((entry, idx) => (
              <div key={entry.username} className={`leader-item ${entry.username === sessionUser ? 'me' : ''}`}>
                <span className={`rank-pill ${idx < 3 ? `top top-${idx + 1}` : ''}`}>#{idx + 1}</span>
                <strong>{entry.username}</strong>
                <em>{entry.score}</em>
              </div>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}
