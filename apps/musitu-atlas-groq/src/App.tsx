import { useEffect, useMemo, useState } from 'react';
import { api } from './lib/client';
import MissionStudio from './Missions';
import CommandPalette from './CommandPalette';
import { readMissions } from './missionStore';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  Download,
  Globe2,
  LayoutDashboard,
  Menu,
  Moon,
  Pause,
  Play,
  Plus,
  Radar,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  TrendingUp,
  Target,
  Workflow,
  X,
  Zap,
} from 'lucide-react';

type Tab = 'overview' | 'missions' | 'assistant' | 'workflows' | 'insights' | 'settings';
type Focus = 'Founder' | 'Analyst' | 'Creator';
type Run = {
  id: string;
  type: string;
  title: string;
  result: string;
  completedAt: string;
  status: 'complete' | 'failed';
};
type Message = { role: 'assistant' | 'user'; text: string };
type Prefs = {
  name: string;
  focus: Focus;
  theme: 'dark' | 'light';
  motion: boolean;
};
type Pulse = { time: string; ms: number };
const steps = [
  {
    id: 'brief',
    name: 'Intelligence brief',
    category: 'RESEARCH',
    desc: 'Turn your focus into a concise strategic briefing.',
    symbol: '◈',
    time: '~20 sec',
  },
  {
    id: 'ideas',
    name: 'Opportunity scanner',
    category: 'DISCOVERY',
    desc: 'Find useful growth ideas, angles and experiments.',
    symbol: '✳',
    time: '~20 sec',
  },
  {
    id: 'plan',
    name: 'Action architect',
    category: 'PLANNING',
    desc: 'Transform a goal into an ordered execution plan.',
    symbol: '↗',
    time: '~20 sec',
  },
];
const prompts: Record<Focus, string[]> = {
  Founder: [
    'Find three growth opportunities',
    'Help me prioritize this week',
    'Write an executive brief',
  ],
  Analyst: [
    'Explain the signal in these results',
    'Design an experiment',
    'Build a decision framework',
  ],
  Creator: [
    'Brainstorm a bold campaign',
    'Help me shape a product story',
    'Turn an idea into an outline',
  ],
};
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}
function clean(s: string, max = 2000) {
  return s.trim().slice(0, max);
}
function niceDay(date: string) {
  const d = new Date(date);
  return isNaN(d.getTime())
    ? 'Recently'
    : new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(d);
}
function dateTitle() {
  return new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}
function linePath(values: number[], w: number, h: number) {
  if (!values.length) return '';
  const mx = Math.max(30, ...values);
  const mn = 0;
  return values
    .map(
      (n, i) =>
        (i ? 'L' : 'M') +
        (10 + (i / Math.max(1, values.length - 1)) * (w - 20)).toFixed(1) +
        ' ' +
        (h - 9 - ((n - mn) / (mx - mn)) * (h - 18)).toFixed(1)
    )
    .join(' ');
}
function Logo() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span>✳</span>
    </div>
  );
}
function TinyChart({ values }: { values: number[] }) {
  return (
    <svg
      className="tiny-chart"
      viewBox="0 0 250 90"
      role="img"
      aria-label="Recent live API response times in milliseconds"
    >
      <defs>
        <linearGradient id="chartWash" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#B9EE75" stopOpacity=".23" />
          <stop offset="1" stopColor="#B9EE75" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[18, 45, 72].map(y => (
        <line
          key={y}
          x1="0"
          y1={y}
          x2="250"
          y2={y}
          stroke="currentColor"
          opacity=".12"
          strokeDasharray="3 4"
        />
      ))}
      {values.length > 1 && (
        <>
          <path
            d={linePath(values, 250, 90) + ' L 240 90 L 10 90 Z'}
            fill="url(#chartWash)"
          />
          <path
            d={linePath(values, 250, 90)}
            stroke="#B9EE75"
            fill="none"
            strokeWidth="2.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}
export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [missionCount, setMissionCount] = useState(() => readMissions().length);
  useEffect(() => { const onKey = (event:KeyboardEvent) => { if ((event.ctrlKey||event.metaKey) && event.key.toLowerCase()==='k') {event.preventDefault();setPaletteOpen(open=>!open);} }; document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey); },[]);
  const [prefs, setPrefs] = useState<Prefs>(() =>
    load('atlas_prefs_v1', {
      name: 'Explorer',
      focus: 'Founder',
      theme: 'dark',
      motion: true,
    })
  );
  const [runs, setRuns] = useState<Run[]>(() => load('atlas_runs_v1', []));
  const [messages, setMessages] = useState<Message[]>(() =>
    load('atlas_chat_v1', [
      {
        role: 'assistant',
        text: 'Welcome to ATLAS. I can help you think through complex decisions, research ideas, and make a clearer plan. What are we working on?',
      },
    ])
  );
  const [draft, setDraft] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiMode, setAiMode] = useState<'fast'|'quality'>(()=>load('atlas_ai_mode','fast'));
  useEffect(()=>save('atlas_ai_mode',aiMode),[aiMode]);
  const [running, setRunning] = useState<string | null>(null);
  const [context, setContext] = useState('');
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [feedback, setFeedback] = useState('');
  const [angle, setAngle] = useState(26);
  const [tilt, setTilt] = useState(-18);
  const [orbitOn, setOrbitOn] = useState(true);
  const [pulse, setPulse] = useState<Pulse[]>([]);
  const [connected, setConnected] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [autoPulse, setAutoPulse] = useState(true);
  useEffect(() => save('atlas_prefs_v1', prefs), [prefs]);
  useEffect(() => save('atlas_runs_v1', runs), [runs]);
  useEffect(() => save('atlas_chat_v1', messages.slice(-24)), [messages]);
  useEffect(() => {
    document.documentElement.dataset.atlasTheme = prefs.theme;
    document.documentElement.dataset.atlasMotion = prefs.motion ? 'on' : 'off';
  }, [prefs.theme, prefs.motion]);
  useEffect(() => {
    let alive = true;
    async function measure() {
      const st = performance.now();
      try {
        const r = await api.get('/api/pulse');
        if (alive) {
          setConnected(Boolean(r.data?.ok));
          setAiConfigured(Boolean(r.data?.aiConfigured));
          setPulse(v =>
            [
              ...v,
              {
                time: new Date().toISOString(),
                ms: Math.max(1, Math.round(performance.now() - st)),
              },
            ].slice(-16)
          );
        }
      } catch {
        if (alive) {setConnected(false);setAiConfigured(false);}
      }
    }
    measure();
    if (!autoPulse)
      return () => {
        alive = false;
      };
    const id = setInterval(measure, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [autoPulse]);
  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(''), 4400);
    return () => clearTimeout(id);
  }, [feedback]);
  const count = runs.filter(r => r.status === 'complete').length;
  const chartValues = pulse.map(p => p.ms);
  const lastPing = chartValues.length
    ? chartValues[chartValues.length - 1]
    : null;
  const firstName = clean(prefs.name, 24).split(' ')[0] || 'Explorer';
  const focusCopy =
    prefs.focus === 'Founder'
      ? 'A command center for your next breakthrough.'
      : prefs.focus === 'Analyst'
        ? 'Turn complex information into better decisions.'
        : 'A studio for ideas worth bringing to life.';
  function go(next: Tab) {
    setTab(next);
    setMobileNav(false);
    setPaletteOpen(false);
    window.scrollTo({ top: 0, behavior: prefs.motion ? 'smooth' : 'auto' });
  }
  function openAsk(q: string) {
    setDraft(q);
    go('assistant');
  }
  async function sendMessage(ev?: React.FormEvent) {
    ev?.preventDefault();
    const question = clean(draft);
    if (!question || sending) return;
    const newHistory: Message[] = [
      ...messages,
      { role: 'user', text: question },
    ];
    setMessages(newHistory);
    setDraft('');
    setSending(true);
    try {
      const r = await api.post('/api/assistant', {
        question,
        focus: prefs.focus,
        history: newHistory.slice(-8),
        mode: aiMode,
      });
      const answer = String(r.data?.answer || '');
      if (!answer) throw new Error('No answer');
      setMessages(m => [...m, { role: 'assistant', text: answer }]);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'Unknown provider error';
      setFeedback('AI request failed: ' + detail);
      setMessages(m => [
        ...m,
        {
          role: 'assistant',
          text: 'The AI request did not succeed: ' + detail,
        },
      ]);
    } finally {
      setSending(false);
    }
  }
  async function runWorkflow(id: string) {
    if (running) return;
    const wf = steps.find(v => v.id === id);
    if (!wf) return;
    setRunning(id);
    setActiveRun(null);
    try {
      const r = await api.post('/api/workflow', {
        type: id,
        focus: prefs.focus,
        context: clean(context, 400),
      });
      const result = clean(String(r.data?.result || ''), 12000);
      if (!result) throw new Error('Empty result');
      const row: Run = {
        id: String(Date.now()) + '-' + id,
        type: id,
        title: wf.name,
        result,
        completedAt: new Date().toISOString(),
        status: 'complete',
      };
      setRuns(old => [row, ...old].slice(0, 80));
      setActiveRun(row);
      setFeedback(wf.name + ' completed.');
    } catch {
      setFeedback('This workflow could not run. Please try again.');
    } finally {
      setRunning(null);
    }
  }
  function exportRuns() {
    const json = JSON.stringify(
      { product: 'ATLAS Studio', exportedAt: new Date().toISOString(), runs },
      null,
      2
    );
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'atlas-workflow-history.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const navigation: { id: Tab; label: string; icon: typeof LayoutDashboard }[] =
    [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'missions', label: 'Mission Control', icon: Target },
      { id: 'assistant', label: 'AI Assistant', icon: Bot },
      { id: 'workflows', label: 'Workflows', icon: Workflow },
      { id: 'insights', label: 'Intelligence', icon: BarChart3 },
      { id: 'settings', label: 'Preferences', icon: Settings2 },
    ];
  return (
    <div className="atlas">
      <a className="skip" href="#primary">
        Skip to content
      </a>
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={'sidebar ' + (mobileNav ? 'sidebar-open' : '')}>
        <div className="brand">
          <Logo />
          <div>
            <strong>MUSITU</strong>
            <small>ATLAS / INTELLIGENCE OS</small>
          </div>
        </div>
        <div className="side-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={'nav-link ' + (tab === item.id ? 'active' : '')}
                onClick={() => go(item.id)}
                aria-current={tab === item.id ? 'page' : undefined}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.id === 'assistant' && <span className="nav-dot" />}
              </button>
            );
          })}
        </nav>
        <div className="side-bottom">
          <div className="side-promo">
            <div className="promo-kicker">
              <Sparkles size={13} /> YOUR WORK, AMPLIFIED
            </div>
            <p>From big questions to real forward motion.</p>
            <button onClick={() => go('assistant')}>
              Ask ATLAS <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="side-foot">
            <div className="avatar">{firstName.charAt(0).toUpperCase()}</div>
            <div>
              <strong>{prefs.name || 'Explorer'}</strong>
              <span>{prefs.focus} workspace</span>
            </div>
            <button
              aria-label="Open preferences"
              onClick={() => go('settings')}
            >
              <Settings2 size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="site-main">
        <header className="topbar">
          <div className="top-left">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              WORKSPACE <ChevronRight size={14} /> <b>{tab.toUpperCase()}</b>
            </span>
          </div>
          <div className="top-right">
            <button type="button" className="search-button" onClick={() => setPaletteOpen(true)} aria-label="Search workspace commands"><Command size={17}/><span>Search anything</span><kbd>⌘ K</kbd></button>
            <div className={'connection ' + (connected ? 'online' : 'offline')}>
              <span className="status-dot" />
              <span>{connected ? 'API ONLINE' : 'RECONNECTING'}</span>
            </div>
            <button
              className="header-avatar"
              onClick={() => go('settings')}
              aria-label="Your profile"
            >
              {firstName.charAt(0).toUpperCase()}
            </button>
          </div>
        </header>
        <main id="primary">
          {tab === 'overview' && (
            <>
              <div className="eyebrow with-line">
                <span className="micro-dot" /> THE INTELLIGENCE WORKSPACE{' '}
                <span className="eyebrow-date">{dateTitle()}</span>
              </div>
              <section className="hero">
                <div className="hero-copy">
                  <div className="welcome-label">
                    <span className="hello-spark">✳</span> GOOD TO HAVE YOU
                    HERE, {firstName.toUpperCase()}
                  </div>
                  <h1>
                    Intelligence,
                    <br />
                    <em>in motion.</em>
                  </h1>
                  <p>
                    {focusCopy} Connect your thinking, your tools and your next
                    moves in one beautiful space.
                  </p>
                  <div className="hero-actions">
                    <button
                      className="primary-btn"
                      onClick={() => go('assistant')}
                    >
                      <Sparkles size={18} /> Start with AI{' '}
                      <ArrowUpRight size={18} />
                    </button>
                    <button
                      className="quiet-btn"
                      onClick={() => go('workflows')}
                    >
                      Explore workflows <ArrowRight size={17} />
                    </button>
                  </div>
                  <div className="hero-trust">
                    <span className="trust-line" />
                    <span>YOUR PRIVATE CONCEPT WORKSPACE</span>
                    <span className="trust-line" />
                  </div>
                </div>
                <div className="hero-visual">
                  <div className="stage-top">
                    <span>01 / INTERACTIVE CORE</span>
                    <span className="stage-mark">ATLAS ◇</span>
                  </div>
                  <div
                    className={
                      'orb-scene ' +
                      (orbitOn && prefs.motion ? 'orb-animate' : '')
                    }
                  >
                    <div
                      className="orb-space"
                      style={{
                        transform:
                          'rotateX(' + tilt + 'deg) rotateY(' + angle + 'deg)',
                      }}
                    >
                      <div className="orb-ring ring-one" />
                      <div className="orb-ring ring-two" />
                      <div className="orb-ring ring-three" />
                      <div className="orb-center">
                        <div className="orb-center-inner">✳</div>
                      </div>
                      <span className="orb-point point-a" />
                      <span className="orb-point point-b" />
                      <span className="orb-point point-c" />
                    </div>
                  </div>
                  <div className="stage-bottom">
                    <div>
                      <span className="status-ring" /> INTELLIGENCE CORE{' '}
                      <b>ACTIVE</b>
                    </div>
                    <button
                      type="button"
                      className="stage-toggle"
                      title={
                        orbitOn
                          ? 'Pause orbital motion'
                          : 'Resume orbital motion'
                      }
                      aria-label={
                        orbitOn
                          ? 'Pause orbital motion'
                          : 'Resume orbital motion'
                      }
                      onClick={() => setOrbitOn(v => !v)}
                    >
                      {orbitOn ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                  </div>
                  <div className="orb-controls">
                    <label>
                      ORBIT{' '}
                      <input
                        aria-label="Rotate 3D core"
                        type="range"
                        min="-180"
                        max="180"
                        value={angle}
                        onChange={e => setAngle(Number(e.target.value))}
                      />
                    </label>
                    <label>
                      TILT{' '}
                      <input
                        aria-label="Tilt 3D core"
                        type="range"
                        min="-65"
                        max="65"
                        value={tilt}
                        onChange={e => setTilt(Number(e.target.value))}
                      />
                    </label>
                    <button
                      title="Reset 3D view"
                      aria-label="Reset 3D view"
                      onClick={() => {
                        setAngle(26);
                        setTilt(-18);
                      }}
                    >
                      <RotateCcw size={15} />
                    </button>
                  </div>
                </div>
              </section>
              <section
                className="numbers"
                aria-label="Workspace activity summary"
              >
                <div>
                  <span className="metric-label">
                    WORKFLOWS COMPLETED <Workflow size={17} />
                  </span>
                  <strong>{count.toString().padStart(2, '0')}</strong>
                  <small>
                    <span className="positive">↗</span> Recorded on this device
                  </small>
                </div>
                <div>
                  <span className="metric-label">
                    AI CONVERSATION TURNS <Bot size={17} />
                  </span>
                  <strong>
                    {messages
                      .filter(m => m.role === 'user')
                      .length.toString()
                      .padStart(2, '0')}
                  </strong>
                  <small>
                    <span className="tiny-green" /> Your exploration so far
                  </small>
                </div>
                <div>
                  <span className="metric-label">
                    API RESPONSE TIME <Activity size={17} />
                  </span>
                  <strong>
                    {lastPing === null ? '—' : lastPing}
                    <span className="unit">
                      {lastPing === null ? '' : 'ms'}
                    </span>
                  </strong>
                  <small>
                    {connected
                      ? 'Real-time health measurement'
                      : 'Checking connection'}
                  </small>
                </div>
              </section>
              <div className="mission-overview-strip"><div className="mission-overview-symbol"><Target size={24}/></div><div><span className="section-overline">NEW / MISSION CONTROL</span><h3>Give your goals a flight plan.</h3><p>{missionCount ? `${missionCount} mission${missionCount===1?'':'s'} saved on this device` : 'Turn ideas into trackable, evidence-led milestones.'}</p></div><button type="button" className="m-secondary-btn" onClick={() => go('missions')}>Open Mission Control <ArrowUpRight size={17}/></button></div>
              <div className="section-heading">
                <div>
                  <span className="section-overline">HOW CAN WE HELP?</span>
                  <h2>Move from idea to impact.</h2>
                </div>
                <button className="text-link" onClick={() => go('workflows')}>
                  View all workflows <ArrowUpRight size={17} />
                </button>
              </div>
              <section className="quick-grid">
                {steps.map((v, i) => (
                  <article className="quick-card" key={v.id}>
                    <div className="quick-head">
                      <span className="quick-symbol">{v.symbol}</span>
                      <span className="quick-id">
                        0{i + 1} / {v.category}
                      </span>
                    </div>
                    <h3>{v.name}</h3>
                    <p>{v.desc}</p>
                    <button
                      className="card-action"
                      onClick={() => {
                        go('workflows');
                        setContext('');
                      }}
                      aria-label={'Explore ' + v.name}
                    >
                      Explore workflow <ArrowUpRight size={17} />
                    </button>
                  </article>
                ))}
              </section>
              <section className="lower-grid">
                <div className="panel pulse-panel">
                  <div className="panel-header">
                    <div>
                      <span className="section-overline">
                        LIVE SYSTEM TELEMETRY
                      </span>
                      <h3>Connection pulse</h3>
                    </div>
                    <span className="live-badge">
                      <span className="status-dot" /> LIVE
                    </span>
                  </div>
                  <div className="pulse-flex">
                    <div>
                      <strong>
                        {lastPing === null ? '—' : lastPing}
                        <small>{lastPing === null ? '' : ' ms'}</small>
                      </strong>
                      <p>Latest measured round-trip time</p>
                      <span className="caption-muted">
                        Real API calls · updated every 15s
                      </span>
                    </div>
                    <TinyChart values={chartValues} />
                  </div>
                  <div className="panel-bottom">
                    <span>
                      {chartValues.length} measurement
                      {chartValues.length === 1 ? '' : 's'} this session
                    </span>
                    <button onClick={() => setAutoPulse(v => !v)}>
                      {autoPulse ? 'Pause updates' : 'Resume updates'}{' '}
                      {autoPulse ? <Pause size={13} /> : <Play size={13} />}
                    </button>
                  </div>
                </div>
                <div className="panel ask-panel">
                  <div className="panel-header">
                    <div>
                      <span className="section-overline">CO-PILOT</span>
                      <h3>One good question changes everything.</h3>
                    </div>
                    <div className="assistant-bubble">
                      <Sparkles size={18} />
                    </div>
                  </div>
                  <p>
                    Intelligence on demand. An AI thinking partner for whatever
                    comes next.
                  </p>
                  <div className="prompt-stack">
                    {prompts[prefs.focus].slice(0, 2).map(q => (
                      <button key={q} onClick={() => openAsk(q)}>
                        <span>{q}</span>
                        <ArrowUpRight size={16} />
                      </button>
                    ))}
                  </div>
                </div>
              </section>
              <footer className="site-footer">
                <span>
                  ✳ ATLAS{' '}
                  <span className="footer-small">
                    / A MUSITU CONCEPT EXPERIENCE
                  </span>
                </span>
                <span>
                  BUILT FOR WHAT'S NEXT <span>↗</span>
                </span>
              </footer>
            </>
          )}
          {tab === 'missions' && <MissionStudio focus={prefs.focus} onAsk={openAsk} onChange={setMissionCount} />}
          {tab === 'assistant' && (
            <div className="inner-page">
              <div className="page-title">
                <span className="section-overline">
                  YOUR THINKING PARTNER / 01
                </span>
                <h1>
                  Think bigger.
                  <br />
                  <em>Move faster.</em>
                </h1>
                <p>
                  An AI assistant using Groq models when the backend is configured. Explore, analyze and create.
                  Replies are generated live, not pre-written.
                </p>
              </div>
              <div className="chat-layout">
                <section className="chat-panel" aria-label="AI conversation">
                  <div className="chat-top">
                    <div className="mini-brand">
                      <Logo />
                      <div>
                        <strong>ATLAS AI</strong>
                        <small>INTELLIGENT COLLABORATOR</small>
                      </div>
                    </div>
                    <span
                      className={'live-badge ' + (!connected ? 'muted' : '')}
                    >
                      <span className="status-dot" />
                      {!connected ? 'RECONNECTING' : aiConfigured ? 'GROQ READY' : 'GROQ SETUP REQUIRED'}
                    </span>
                  </div>
                  {!aiConfigured && <div className="groq-config-notice" role="status">Groq inference requires a backend API key. The AI assistant will become available after the site administrator configures GROQ_API_KEY.</div>}
                  <div className="groq-choice"><label htmlFor="groq-model">Groq model</label><select id="groq-model" value={aiMode} onChange={e=>setAiMode(e.target.value as 'fast'|'quality')}><option value="fast">GPT-OSS 20B · Fast</option><option value="quality">GPT-OSS 120B · Quality</option></select></div><div className="chat-thread" role="log" aria-live="polite">
                    {messages.map((m, i) => (
                      <div className={'message ' + m.role} key={i}>
                        {m.role === 'assistant' && (
                          <div className="message-icon">✳</div>
                        )}
                        <div className="message-body">{m.text}</div>
                      </div>
                    ))}
                    {sending && (
                      <div className="message assistant">
                        <div className="message-icon">✳</div>
                        <div className="message-body typing">
                          ATLAS is thinking <span>•••</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <form className="chat-compose" onSubmit={sendMessage}>
                    <label htmlFor="prompt" className="sr-only">
                      Message the AI assistant
                    </label>
                    <textarea
                      id="prompt"
                      placeholder="Ask anything. Start with an idea..."
                      value={draft}
                      onChange={e => setDraft(e.target.value.slice(0, 2000))}
                      rows={2}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void sendMessage();
                        }
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!draft.trim() || sending}
                      aria-label="Send message"
                    >
                      <Send size={19} />
                    </button>
                  </form>
                  <div className="chat-disclaimer">
                    AI responses can make mistakes. Verify important
                    information. Conversation stored on this device.
                  </div>
                </section>
                <aside className="chat-aside">
                  <span className="section-overline">
                    JUMPSTART YOUR THINKING
                  </span>
                  <h3>Need a starting point?</h3>
                  {prompts[prefs.focus].map((q, i) => (
                    <button
                      className="idea-card"
                      key={q}
                      onClick={() => setDraft(q)}
                    >
                      <span>0{i + 1}</span>
                      {q}
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                  <div className="aside-note">
                    <ShieldCheck size={20} />
                    <p>
                      Guest workspace: no account connected. Messages remain in
                      this browser; AI prompts are processed by the assistant
                      service.
                    </p>
                  </div>
                </aside>
              </div>
            </div>
          )}
          {tab === 'workflows' && (
            <div className="inner-page">
              <div className="page-title">
                <span className="section-overline">
                  FROM INTENTION TO EXECUTION / 02
                </span>
                <h1>
                  Make progress
                  <br />
                  <em>repeatable.</em>
                </h1>
                <p>
                  Three AI-powered workflows. Choose your context, run a
                  process, and get a concrete, reusable output.
                </p>
              </div>
              <div className="workflow-form">
                <label htmlFor="workflow-context">
                  <span className="section-overline">YOUR CONTEXT</span>
                  <span>
                    What should ATLAS focus on? <i>(optional)</i>
                  </span>
                </label>
                <textarea
                  id="workflow-context"
                  value={context}
                  maxLength={400}
                  onChange={e => setContext(e.target.value)}
                  placeholder="e.g. Growing a software business, launching a product, improving customer experience..."
                  rows={2}
                />
                <div className="context-foot">
                  <span>
                    AI-assisted output. No external actions are performed.
                  </span>
                  <span>{context.length}/400</span>
                </div>
              </div>
              <section className="workflow-list">
                {steps.map((wf, i) => (
                  <article className="workflow-row" key={wf.id}>
                    <div className="workflow-num">0{i + 1}</div>
                    <div className="workflow-icon">{wf.symbol}</div>
                    <div className="workflow-descriptor">
                      <span className="section-overline">
                        {wf.category} / AI-POWERED
                      </span>
                      <h3>{wf.name}</h3>
                      <p>{wf.desc}</p>
                      <div className="workflow-tags">
                        <span>
                          <Clock3 size={12} /> {wf.time} typical*
                        </span>
                        <span>3-stage process</span>
                      </div>
                    </div>
                    <button
                      className="run-btn"
                      disabled={Boolean(running)}
                      onClick={() => runWorkflow(wf.id)}
                    >
                      {running === wf.id ? (
                        <>
                          <RefreshCw className="spin" size={17} /> Running
                        </>
                      ) : (
                        <>
                          Run workflow <ArrowUpRight size={17} />
                        </>
                      )}
                    </button>
                  </article>
                ))}
              </section>
              <div className="workflow-footnote">
                *Durations are indicative and depend on model availability. Each
                run collects context, analyzes with AI and generates an output.
              </div>
              {activeRun && (
                <section className="result-panel" aria-live="polite">
                  <div className="result-title">
                    <span className="positive">
                      <CheckCircle2 size={18} /> COMPLETED
                    </span>
                    <button
                      onClick={() => setActiveRun(null)}
                      aria-label="Close workflow result"
                    >
                      <X size={17} />
                    </button>
                  </div>
                  <h2>{activeRun.title}</h2>
                  <div className="stage-breadcrumb">
                    <span>
                      <Check size={14} /> Context
                    </span>
                    <ChevronRight size={14} />
                    <span>
                      <Check size={14} /> AI analysis
                    </span>
                    <ChevronRight size={14} />
                    <span>
                      <Check size={14} /> Output
                    </span>
                  </div>
                  <pre className="result-text">{activeRun.result}</pre>
                </section>
              )}
              <div className="section-heading history-title">
                <div>
                  <span className="section-overline">
                    YOUR WORKSPACE ARCHIVE
                  </span>
                  <h2>Recent executions</h2>
                </div>
                <button className="text-link" onClick={exportRuns}>
                  <Download size={16} /> Export JSON
                </button>
              </div>
              {runs.length === 0 ? (
                <div className="empty-state">
                  <Workflow size={25} />
                  <strong>A blank slate. A lot of potential.</strong>
                  <p>Your completed workflow outputs will appear here.</p>
                </div>
              ) : (
                <div className="history-list">
                  {runs.slice(0, 12).map(r => (
                    <button
                      key={r.id}
                      className="history-item"
                      onClick={() => setActiveRun(r)}
                    >
                      <CheckCircle2 size={18} />
                      <span>
                        <strong>{r.title}</strong>
                        <small>{niceDay(r.completedAt)}</small>
                      </span>
                      <ArrowUpRight size={17} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {tab === 'insights' && (
            <div className="inner-page">
              <div className="page-title">
                <span className="section-overline">
                  CLARITY THROUGH SIGNAL / 03
                </span>
                <h1>
                  See what
                  <br />
                  <em>actually moves.</em>
                </h1>
                <p>
                  Real usage insights from this browser session and your saved
                  workflow history. No invented business metrics.
                </p>
              </div>
              <div className="insight-cards">
                <div className="insight-card">
                  <span>COMPLETED WORKFLOWS</span>
                  <strong>{count}</strong>
                  <small>All-time on this device</small>
                  <Workflow size={21} />
                </div>
                <div className="insight-card">
                  <span>QUESTIONS ASKED</span>
                  <strong>
                    {messages.filter(m => m.role === 'user').length}
                  </strong>
                  <small>Your AI conversation</small>
                  <Bot size={21} />
                </div>
                <div className="insight-card">
                  <span>CONNECTION STATUS</span>
                  <strong className="status-word">
                    {connected ? 'Online' : 'Offline'}
                  </strong>
                  <small>
                    {lastPing === null
                      ? 'No measurements yet'
                      : lastPing + ' ms · last ping'}
                  </small>
                  <Radar size={21} />
                </div>
              </div>
              <div className="insight-detail">
                <div className="panel">
                  <div className="panel-header">
                    <div>
                      <span className="section-overline">
                        NETWORK MEASUREMENTS
                      </span>
                      <h3>Live API performance</h3>
                    </div>
                    <span className="live-badge">
                      <span className="status-dot" /> LIVE
                    </span>
                  </div>
                  <div className="large-chart">
                    <TinyChart values={chartValues} />
                  </div>
                  <div className="insight-scale">
                    <span>Recent round-trip latency</span>
                    <strong>
                      {lastPing === null
                        ? 'Waiting for first sample'
                        : lastPing + ' ms'}
                    </strong>
                  </div>
                  <p className="chart-note">
                    Measurements reflect actual requests from your device. They
                    are not financial or external market data.
                  </p>
                  <button
                    className="outline-btn"
                    onClick={() => setAutoPulse(v => !v)}
                  >
                    {autoPulse ? 'Pause monitoring' : 'Resume monitoring'}{' '}
                    {autoPulse ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                </div>
                <div className="panel activity-panel">
                  <span className="section-overline">ACTIVITY FEED</span>
                  <h3>Your latest progress</h3>
                  {runs.length ? (
                    <div className="activity-list">
                      {runs.slice(0, 6).map(r => (
                        <div key={r.id}>
                          <span className="activity-dot" />
                          <span>
                            <strong>{r.title}</strong>
                            <small>{niceDay(r.completedAt)}</small>
                          </span>
                          <CheckCircle2 size={16} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="activity-empty">
                      <Activity size={28} />
                      <p>
                        Run a workflow to start building your activity history.
                      </p>
                      <button
                        className="text-link"
                        onClick={() => go('workflows')}
                      >
                        Go to workflows <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {tab === 'settings' && (
            <div className="inner-page">
              <div className="page-title">
                <span className="section-overline">
                  A SPACE THAT FITS YOU / 04
                </span>
                <h1>
                  Make it
                  <br />
                  <em>yours.</em>
                </h1>
                <p>
                  Small preferences that shape a more focused workspace. Saved
                  locally in this browser.
                </p>
              </div>
              <div className="settings-grid">
                <section className="panel settings-panel">
                  <span className="section-overline">01 / YOUR IDENTITY</span>
                  <h3>How should we welcome you?</h3>
                  <label className="field-label" htmlFor="profile-name">
                    Display name
                  </label>
                  <input
                    id="profile-name"
                    type="text"
                    maxLength={32}
                    value={prefs.name}
                    onChange={e =>
                      setPrefs(p => ({ ...p, name: e.target.value }))
                    }
                    placeholder="Your name"
                  />
                  <label className="field-label" htmlFor="focus-select">
                    Workspace focus
                  </label>
                  <select
                    id="focus-select"
                    value={prefs.focus}
                    onChange={e =>
                      setPrefs(p => ({ ...p, focus: e.target.value as Focus }))
                    }
                  >
                    <option value="Founder">Founder — strategy & growth</option>
                    <option value="Analyst">
                      Analyst — research & decisions
                    </option>
                    <option value="Creator">
                      Creator — ideas & storytelling
                    </option>
                  </select>
                  <p className="setting-explain">
                    Your focus changes the suggested prompts and context sent
                    with AI requests.
                  </p>
                </section>
                <section className="panel settings-panel">
                  <span className="section-overline">02 / YOUR EXPERIENCE</span>
                  <h3>Fine-tune the atmosphere.</h3>
                  <div className="pref-group">
                    <span>Color theme</span>
                    <div className="segmented">
                      <button
                        className={prefs.theme === 'dark' ? 'selected' : ''}
                        onClick={() => setPrefs(p => ({ ...p, theme: 'dark' }))}
                      >
                        <Moon size={16} /> Midnight
                      </button>
                      <button
                        className={prefs.theme === 'light' ? 'selected' : ''}
                        onClick={() =>
                          setPrefs(p => ({ ...p, theme: 'light' }))
                        }
                      >
                        <Sun size={16} /> Daylight
                      </button>
                    </div>
                  </div>
                  <div className="pref-group toggle-row">
                    <div>
                      <strong>Motion effects</strong>
                      <small>Orbit animation and smooth transitions</small>
                    </div>
                    <button
                      className={'switch ' + (prefs.motion ? 'on' : '')}
                      role="switch"
                      aria-checked={prefs.motion}
                      aria-label="Motion effects"
                      onClick={() =>
                        setPrefs(p => ({ ...p, motion: !p.motion }))
                      }
                    >
                      <span />
                    </button>
                  </div>
                  <div className="pref-group toggle-row">
                    <div>
                      <strong>Live monitoring</strong>
                      <small>Recheck system connection every 15s</small>
                    </div>
                    <button
                      className={'switch ' + (autoPulse ? 'on' : '')}
                      role="switch"
                      aria-checked={autoPulse}
                      aria-label="Live monitoring"
                      onClick={() => setAutoPulse(v => !v)}
                    >
                      <span />
                    </button>
                  </div>
                </section>
              </div>
              <section className="settings-disclosure">
                <ShieldCheck size={22} />
                <div>
                  <strong>
                    A personal demo workspace, not a connected enterprise
                    account.
                  </strong>
                  <p>
                    Your preferences, chat display history, missions and generated
                    workflow archive are stored in this browser. AI questions
                    and workflow context are sent to the backend AI service when
                    you submit them. No third-party business integrations or
                    recurring server automations have been configured.
                  </p>
                </div>
              </section>
              <button
                className="outline-btn"
                onClick={() => {
                  if (
                    window.confirm(
                      'Clear local chat and workflow history on this device?'
                    )
                  ) {
                    setRuns([]);
                    setMessages([
                      {
                        role: 'assistant',
                        text: 'A fresh start. What would you like to explore?',
                      },
                    ]);
                    setActiveRun(null);
                    setFeedback('Local history cleared.');
                  }
                }}
              >
                Clear local history <RotateCcw size={16} />
              </button>
            </div>
          )}
        </main>
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onNavigate={go} runTitles={runs.map(r => r.title)} />}
      {feedback && (
        <div className="toast" role="status">
          <span>✳</span>
          {feedback}
          <button onClick={() => setFeedback('')} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
