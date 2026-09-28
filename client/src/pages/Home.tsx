import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  Clock3,
  Headphones,
  Info,
  Keyboard,
  Medal,
  Mic2,
  Pause,
  Play,
  Delete,
  RotateCcw,
  Square,
  Sparkles,
  Volume2,
  X,
  Zap,
} from "lucide-react";

type Mode = "practice" | "quiz" | "test";
type Feedback = "correct" | "incorrect" | "timeout" | null;

type Stats = {
  attempts: number;
  correct: number;
  bestStreak: number;
  currentStreak: number;
  quizzes: number;
  bestQuiz: number;
  tests: number;
  bestTest: number;
};

const STATS_KEY = "french-number-listening-stats-v1";
const QUIZ_LENGTH = 10;
const FEEDBACK_MS = 3000;
const TEST_SECONDS = 4;

const defaultStats: Stats = {
  attempts: 0,
  correct: 0,
  bestStreak: 0,
  currentStreak: 0,
  quizzes: 0,
  bestQuiz: 0,
  tests: 0,
  bestTest: 0,
};

const modeMeta: Record<Mode, { label: string; eyebrow: string; description: string; icon: typeof Headphones }> = {
  practice: {
    label: "Practice",
    eyebrow: "No pressure",
    description: "Keep listening until the numbers feel natural.",
    icon: Headphones,
  },
  quiz: {
    label: "10-question quiz",
    eyebrow: "Build confidence",
    description: "A short set with instant feedback after every answer.",
    icon: BarChart3,
  },
  test: {
    label: "Timed test",
    eyebrow: "Test conditions",
    description: "Ten numbers. Four seconds per question. Stay sharp.",
    icon: Clock3,
  },
};

const frenchBelow20 = [
  "zéro",
  "un",
  "deux",
  "trois",
  "quatre",
  "cinq",
  "six",
  "sept",
  "huit",
  "neuf",
  "dix",
  "onze",
  "douze",
  "treize",
  "quatorze",
  "quinze",
  "seize",
  "dix-sept",
  "dix-huit",
  "dix-neuf",
];

function frenchNumber(n: number): string {
  if (n < 20) return frenchBelow20[n];
  if (n < 70) {
    const tens = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];
    const ten = Math.floor(n / 10);
    const unit = n % 10;
    if (unit === 0) return tens[ten];
    if (unit === 1) return `${tens[ten]} et un`;
    return `${tens[ten]}-${frenchBelow20[unit]}`;
  }
  if (n < 80) {
    const unit = n - 60;
    if (unit === 11) return "soixante et onze";
    if (unit < 20) return `soixante-${frenchBelow20[unit]}`;
  }
  if (n < 100) {
    const unit = n - 80;
    if (unit === 0) return "quatre-vingts";
    if (unit === 1) return "quatre-vingt-un";
    return `quatre-vingt-${frenchBelow20[unit]}`;
  }
  return "cent";
}

function normalizeNumber(value: string): number | null {
  const cleaned = value.trim().replace(/\s/g, "");
  if (!/^\d{1,3}$/.test(cleaned)) return null;
  const number = Number(cleaned);
  return number >= 0 && number <= 100 ? number : null;
}

function loadStats(): Stats {
  try {
    const saved = localStorage.getItem(STATS_KEY);
    return saved ? { ...defaultStats, ...JSON.parse(saved) } : defaultStats;
  } catch {
    return defaultStats;
  }
}

function pickFrenchVoice(): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  const french = voices.filter((voice) => voice.lang.toLowerCase().startsWith("fr"));
  const feminineHint = /female|femme|woman|amelie|audrey|aurelie|celine|chlo|marie|thomas|hortense|google français|microsoft denise/i;
  return french.find((voice) => feminineHint.test(`${voice.name} ${voice.voiceURI}`)) || french[0];
}

function speakFrench(text: string, slow = false) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  utterance.rate = slow ? 0.72 : 0.88;
  utterance.pitch = 1.05;
  const voice = pickFrenchVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function formatPercent(correct: number, attempts: number) {
  return attempts ? `${Math.round((correct / attempts) * 100)}%` : "—";
}

function StatPill({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`stat-pill ${accent ? "stat-pill-accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AppLogo() {
  return (
    <div className="brand-lockup" aria-label="French Number Lab">
      <div className="brand-mark"><span>n</span><span>°</span></div>
      <div>
        <div className="brand-name">French Number Lab</div>
        <div className="brand-tagline">listen · think · answer</div>
      </div>
    </div>
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("practice");
  const [active, setActive] = useState(false);
  const [currentNumber, setCurrentNumber] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [questionNumber, setQuestionNumber] = useState(1);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TEST_SECONDS);
  const [stats, setStats] = useState<Stats>(defaultStats);
  const [showStats, setShowStats] = useState(false);
  const [hasVoices, setHasVoices] = useState(true);
  const [useKeypad] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse), (max-width: 700px)").matches);
  const inputRef = useRef<HTMLInputElement>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answerDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questionTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(active);
  const modeRef = useRef(mode);
  const currentNumberRef = useRef<number | null>(currentNumber);
  const feedbackRef = useRef<Feedback>(feedback);

  useEffect(() => {
    activeRef.current = active;
    if (active && window.matchMedia("(max-width: 700px)").matches) {
      document.querySelector(".practice-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [active]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { currentNumberRef.current = currentNumber; }, [currentNumber]);
  useEffect(() => { feedbackRef.current = feedback; }, [feedback]);

  useEffect(() => {
    setStats(loadStats());
    if ("speechSynthesis" in window) {
      const updateVoices = () => setHasVoices(window.speechSynthesis.getVoices().some((voice) => voice.lang.toLowerCase().startsWith("fr")));
      updateVoices();
      window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
      return () => window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
    }
    setHasVoices(false);
  }, []);

  useEffect(() => {
    if (!active || mode !== "test" || feedback) return;
    setTimeLeft(TEST_SECONDS);
    const started = Date.now();
    questionTimer.current = setInterval(() => {
      const elapsed = (Date.now() - started) / 1000;
      const remaining = Math.max(0, TEST_SECONDS - elapsed);
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(questionTimer.current!);
        submitAnswer("");
      }
    }, 50);
    return () => { if (questionTimer.current) clearInterval(questionTimer.current); };
  }, [active, mode, currentNumber, feedback]);

  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    if (answerDebounceTimer.current) clearTimeout(answerDebounceTimer.current);
    if (questionTimer.current) clearInterval(questionTimer.current);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const currentFrench = useMemo(() => currentNumber === null ? "" : frenchNumber(currentNumber), [currentNumber]);
  const isSessionComplete = active && mode !== "practice" && questionNumber > QUIZ_LENGTH;
  const sessionLabel = mode === "practice" ? "Open practice" : mode === "quiz" ? "10-question quiz" : "Timed test";
  const modeIcon = modeMeta[mode].icon;

  const saveStats = useCallback((nextStats: Stats) => {
    setStats(nextStats);
    localStorage.setItem(STATS_KEY, JSON.stringify(nextStats));
  }, []);

  const nextQuestion = useCallback((nextQuestionNumber?: number) => {
    const nextNumber = Math.floor(Math.random() * 101);
    setCurrentNumber(nextNumber);
    currentNumberRef.current = nextNumber;
    setInput("");
    setFeedback(null);
    feedbackRef.current = null;
    setTimeLeft(TEST_SECONDS);
    if (typeof nextQuestionNumber === "number") setQuestionNumber(nextQuestionNumber);
    if (!useKeypad) window.setTimeout(() => inputRef.current?.focus(), 80);
    speakFrench(frenchNumber(nextNumber));
  }, [useKeypad]);

  const startSession = useCallback((selectedMode: Mode = mode) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    if (questionTimer.current) clearInterval(questionTimer.current);
    setMode(selectedMode);
    modeRef.current = selectedMode;
    setActive(true);
    activeRef.current = true;
    setScore(0);
    setQuestionNumber(1);
    setFeedback(null);
    feedbackRef.current = null;
    const nextNumber = Math.floor(Math.random() * 101);
    setCurrentNumber(nextNumber);
    currentNumberRef.current = nextNumber;
    setInput("");
    setTimeLeft(TEST_SECONDS);
    if (!useKeypad) window.setTimeout(() => inputRef.current?.focus(), 120);
    speakFrench(frenchNumber(nextNumber));
  }, [mode, useKeypad]);

  const stopSession = useCallback(() => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    if (answerDebounceTimer.current) clearTimeout(answerDebounceTimer.current);
    if (questionTimer.current) clearInterval(questionTimer.current);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setActive(false);
    activeRef.current = false;
    setFeedback(null);
    feedbackRef.current = null;
    setInput("");
    setScore(0);
    setQuestionNumber(1);
    setTimeLeft(TEST_SECONDS);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const finishSession = useCallback((finalScore: number, finalMode: Mode) => {
    setActive(false);
    activeRef.current = false;
    setFeedback(null);
    feedbackRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    const current = loadStats();
    const nextStats = finalMode === "quiz"
      ? { ...current, quizzes: current.quizzes + 1, bestQuiz: Math.max(current.bestQuiz, finalScore) }
      : finalMode === "test"
        ? { ...current, tests: current.tests + 1, bestTest: Math.max(current.bestTest, finalScore) }
        : current;
    saveStats(nextStats);
  }, [saveStats]);

  const submitAnswer = useCallback((submitted: string) => {
    const number = currentNumberRef.current;
    if (!activeRef.current || number === null || feedbackRef.current) return;
    if (questionTimer.current) clearInterval(questionTimer.current);
    const parsed = normalizeNumber(submitted);
    const isTimeout = submitted === "" && modeRef.current === "test";
    const isCorrect = parsed === number;
    const result: Feedback = isTimeout ? "timeout" : isCorrect ? "correct" : "incorrect";
    const current = loadStats();
    const nextCurrentStreak = isCorrect ? current.currentStreak + 1 : 0;
    const nextStats: Stats = {
      ...current,
      attempts: current.attempts + 1,
      correct: current.correct + (isCorrect ? 1 : 0),
      currentStreak: nextCurrentStreak,
      bestStreak: Math.max(current.bestStreak, nextCurrentStreak),
    };
    saveStats(nextStats);
    setScore((previous) => previous + (isCorrect ? 1 : 0));
    setFeedback(result);
    feedbackRef.current = result;

    feedbackTimer.current = setTimeout(() => {
      const finalMode = modeRef.current;
      const nextQuestionNumber = questionNumber + 1;
      if (finalMode !== "practice" && questionNumber >= QUIZ_LENGTH) {
        finishSession((isCorrect ? score + 1 : score), finalMode);
        setQuestionNumber(QUIZ_LENGTH + 1);
      } else {
        nextQuestion(nextQuestionNumber);
      }
    }, FEEDBACK_MS);
  }, [finishSession, nextQuestion, questionNumber, saveStats, score]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitAnswer(input);
  };

  const handleAnswerChange = (value: string) => {
    const nextValue = value.replace(/[^0-9]/g, "").slice(0, 3);
    setInput(nextValue);
    if (mode === "test" && nextValue && !feedback) {
      if (answerDebounceTimer.current) clearTimeout(answerDebounceTimer.current);
      answerDebounceTimer.current = setTimeout(() => submitAnswer(nextValue), 260);
    }
  };

  const pressKey = (key: string) => {
    if (feedback) return;
    if (key === "back") return handleAnswerChange(input.slice(0, -1));
    handleAnswerChange(input + key);
  };

  const handleModeChange = (nextMode: Mode) => {
    if (active) return;
    setMode(nextMode);
  };

  const resetAllProgress = () => {
    saveStats(defaultStats);
    setShowStats(false);
  };

  const showActive = active && !isSessionComplete;
  const percent = mode === "test" ? Math.max(0, Math.min(100, (timeLeft / TEST_SECONDS) * 100)) : 100;
  const CurrentModeIcon = modeIcon;

  return (
    <div className="app-shell">
      <div className="paper-grain" aria-hidden="true" />
      <header className="topbar container">
        <AppLogo />
        <div className="topbar-actions">
          <div className="voice-status" title={hasVoices ? "French voices available" : "Your browser will use its default voice"}>
            <span className={`status-dot ${hasVoices ? "is-ready" : "is-muted"}`} />
            <span>{hasVoices ? "French audio ready" : "Audio ready"}</span>
          </div>
          <button className="stats-trigger" onClick={() => setShowStats((value) => !value)} aria-expanded={showStats}>
            <BarChart3 size={16} />
            <span>My progress</span>
            <ChevronDown size={15} className={showStats ? "rotate-180" : ""} />
          </button>
        </div>
      </header>

      <main className="container main-content">
        <section className="intro-grid">
          <div className="intro-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> French listening practice</div>
            <h1>Hear it.<br /><em>Know it.</em></h1>
            <p className="intro-text">Train your ear for French numbers from zéro to cent. Listen to a number, write what you hear, and build your reflexes one answer at a time.</p>
            <div className="intro-notes">
              <span><Check size={15} /> Instant feedback</span>
              <span><Check size={15} /> Your progress stays private</span>
            </div>
          </div>
          <div className="tip-card">
            <div className="tip-icon"><Sparkles size={18} /></div>
            <div>
              <div className="tip-label">Little tip</div>
              <p>Listen for the <strong>“et un”</strong> in 21, 31, 41, 51, 61 — and the rhythm of 70s and 90s.</p>
            </div>
          </div>
        </section>

        {showStats && (
          <section className="progress-panel card-surface" aria-label="My progress">
            <div className="progress-heading">
              <div><span className="section-kicker">Saved on this device</span><h2>Your progress</h2></div>
              <button className="text-button" onClick={resetAllProgress}><RotateCcw size={14} /> Reset</button>
            </div>
            <div className="stats-grid">
              <StatPill label="Accuracy" value={formatPercent(stats.correct, stats.attempts)} accent />
              <StatPill label="Answered" value={String(stats.attempts)} />
              <StatPill label="Best streak" value={String(stats.bestStreak)} />
              <StatPill label="Best quiz" value={`${stats.bestQuiz}/10`} />
              <StatPill label="Best test" value={`${stats.bestTest}/10`} />
            </div>
          </section>
        )}

        <section className="practice-layout">
          <div className="mode-column">
            <div className="section-kicker">Choose your rhythm</div>
            <h2>How do you want to practice?</h2>
            <div className="mode-list" role="tablist" aria-label="Practice modes">
              {(Object.keys(modeMeta) as Mode[]).map((item) => {
                const meta = modeMeta[item];
                const Icon = meta.icon;
                return (
                  <button key={item} className={`mode-option ${mode === item ? "selected" : ""} ${active ? "disabled" : ""}`} onClick={() => handleModeChange(item)} role="tab" aria-selected={mode === item} disabled={active}>
                    <span className="mode-icon"><Icon size={19} /></span>
                    <span className="mode-copy"><span className="mode-eyebrow">{meta.eyebrow}</span><strong>{meta.label}</strong><small>{meta.description}</small></span>
                    <ArrowRight size={17} className="mode-arrow" />
                  </button>
                );
              })}
            </div>
            <div className="how-it-works">
              <div className="how-icon"><Keyboard size={17} /></div>
              <div><strong>Type the number you hear</strong><span>Use 0–100, then press Enter.</span></div>
            </div>
          </div>

          <div className={`practice-card ${showActive ? "is-active" : ""} ${feedback ? `has-${feedback}` : ""}`}>
            <div className="card-topline">
              <div className="session-label"><CurrentModeIcon size={16} /> {sessionLabel}</div>
              {showActive && (
                <div className="topline-right">
                  {mode !== "practice" && <div className="question-count"><span>{Math.min(questionNumber, QUIZ_LENGTH)}</span> / {QUIZ_LENGTH}</div>}
                  <button type="button" className="stop-button" onClick={stopSession} aria-label="Stop and return to main menu"><Square size={14} fill="currentColor" /> Stop</button>
                </div>
              )}
            </div>

            {!showActive && !isSessionComplete && (
              <div className="start-state">
                <div className="listen-orb"><Headphones size={36} strokeWidth={1.5} /><span /></div>
                <div className="start-kicker">{modeMeta[mode].eyebrow}</div>
                <h3>Ready when you are.</h3>
                <p>{mode === "test" ? "You’ll have 4 seconds to enter each answer." : mode === "quiz" ? "Ten questions with a little breathing room between each one." : "There’s no clock here. Just listen, answer, and learn."}</p>
                <button className="primary-button" onClick={() => startSession()}><Play size={17} fill="currentColor" /> Start {mode === "practice" ? "practicing" : mode === "quiz" ? "the quiz" : "the test"}</button>
                <span className="speech-note"><Mic2 size={13} /> French computer voice · female voice when available</span>
              </div>
            )}

            {showActive && (
              <div className="question-state">
                <div className="question-prompt">Listen carefully<span className="sound-wave"><i /><i /><i /><i /><i /></span></div>
                <div className="number-placeholder" aria-live="polite">{feedback ? (feedback === "correct" ? "✓" : "…") : "?"}</div>
                <div className="audio-actions">
                  <button className="audio-button" onClick={() => currentFrench && speakFrench(currentFrench)} disabled={Boolean(feedback)}><Volume2 size={17} /> Replay audio</button>
                  <button className="speed-button" onClick={() => currentFrench && speakFrench(currentFrench, true)} disabled={Boolean(feedback)}><Pause size={14} /> Slower</button>
                </div>
                {mode === "test" && !feedback && <div className={`countdown ${timeLeft <= 1.25 ? "urgent" : ""}`}><div className="countdown-meta"><span>Time to answer</span><strong>{timeLeft.toFixed(1)}s</strong></div><div className="countdown-track"><div className="countdown-fill" style={{ width: `${percent}%` }} /></div></div>}
                <form className="answer-form" onSubmit={handleSubmit}>
                  <label htmlFor="answer">Your answer</label>
                  <div className="input-row"><input ref={inputRef} id="answer" inputMode={useKeypad ? "none" : "numeric"} readOnly={useKeypad} pattern="[0-9]*" autoComplete="off" value={input} onChange={(event) => handleAnswerChange(event.target.value)} placeholder="?" disabled={Boolean(feedback)} aria-describedby="answer-help" />{!useKeypad && <button type="submit" className="submit-button" disabled={mode === "test" || Boolean(feedback) || !input}>{mode === "test" ? "Auto-check" : "Check"} {mode !== "test" && <ArrowRight size={17} />}</button>}</div>
                  {useKeypad ? (feedback ? null :
                    <div className="keypad" role="group" aria-label="Number pad">
                      {["1","2","3","4","5","6","7","8","9"].map((k) => <button key={k} type="button" className="key" onClick={() => pressKey(k)} disabled={Boolean(feedback)}>{k}</button>)}
                      <button type="button" className="key key-back" onClick={() => pressKey("back")} disabled={Boolean(feedback) || !input} aria-label="Delete"><Delete size={28} /></button>
                      <button type="button" className="key" onClick={() => pressKey("0")} disabled={Boolean(feedback)}>0</button>
                      <button type="submit" className="key key-go" disabled={mode === "test" || Boolean(feedback) || !input}>{mode === "test" ? "Auto" : <Check size={32} strokeWidth={3} />}</button>
                    </div>
                  ) : (
                    <div className="answer-help" id="answer-help"><span>Number only</span><span>{mode === "test" ? "Checks automatically" : "Press Enter ↵"}</span></div>
                  )}
                </form>
                {feedback && (
                  <div className={`feedback-message ${feedback}`} role="status">
                    <div className="feedback-icon">{feedback === "correct" ? <Check size={20} strokeWidth={2.5} /> : <X size={20} strokeWidth={2.5} />}</div>
                    <div><strong>{feedback === "correct" ? "Perfect — that’s right." : feedback === "timeout" ? "Time’s up." : "Not quite this time."}</strong>{feedback !== "correct" && <span>The answer was <b>{currentNumber}</b> · <em>{currentFrench}</em></span>}{feedback === "correct" && <span>Nice listening. Next one is coming up.</span>}</div>
                    <div className="feedback-timer" aria-hidden="true"><span /></div>
                  </div>
                )}
              </div>
            )}

            {isSessionComplete && (
              <div className="complete-state">
                <div className="complete-medal"><Medal size={34} /></div>
                <div className="start-kicker">{mode === "quiz" ? "Quiz complete" : "Test complete"}</div>
                <h3>{score} <span>/ 10</span></h3>
                <p>{score >= 8 ? "Excellent ear. Your number reflexes are getting strong." : score >= 5 ? "Good work. A little more listening will make these stick." : "Keep going — every replay is building your French ear."}</p>
                <div className="result-line"><span>Accuracy</span><strong>{score * 10}%</strong></div>
                <button className="primary-button" onClick={() => startSession(mode)}><RotateCcw size={16} /> Try again</button>
              </div>
            )}
          </div>
        </section>

        <section className="footer-note"><div className="footer-rule" /><div><Info size={15} /><span>Numbers are chosen randomly from 0 to 100. Your practice history is saved only in this browser.</span></div><div className="footer-rule" /></section>
      </main>
      <footer className="site-footer container"><span>Made for better French listening</span><span className="footer-dot">·</span><span>zéro → cent</span><Zap size={13} /></footer>
    </div>
  );
}
