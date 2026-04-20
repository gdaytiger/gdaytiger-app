'use client';

import { useEffect, useState, useRef } from 'react';

interface Todo {
  id: string;
  text: string;
  checked: boolean;
  isHeader?: boolean;
}

interface Project {
  id: string;
  name: string;
  status: string;
  todos: Todo[];
}

interface Shift {
  date: string;
  label: string;
  working: boolean;
  start: string;
  end: string;
  area: string;
  comment: string;
}

interface DashboardData {
  dateStr: string;
  weather: string;
  todayStr: string;
  dailyTasks: Todo[];
  projects: Project[];
  personalTodos: Todo[];
}

interface WeekDay {
  count: number;
  tasks: Todo[];
}

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudePanelState {
  projectId: string;
  projectName: string;
  actionText: string;
  messages: ClaudeMessage[];
}

const SUPPLIER_LINKS: Record<string, string> = {
  'dench': 'https://denchbakers.cybakeshop.com.au/home',
  'seven seeds': 'https://sevenseedswholesale.com.au/account/',
  'noisette': 'https://connect.noisette.com.au/',
  'redimilk': 'tel:0397024262',
  'candied': `mailto:hello@candiedbakery.com.au?subject=${encodeURIComponent("G'DAY TIGER Order")}&body=${encodeURIComponent("Hey Guys,\n\nCan we please get\nx Paninis\nx Marshmallow Cookies\nx Candied Pies\nx Brownie Slab\nx Maple Pecan\n\nThanks,\nJono")}`,
};

const applyServerChecked = (todos: Todo[], date: string, state: Record<string, string[]>): Todo[] => {
  const checkedIds = new Set(state[date] || []);
  return todos.map(t => t.isHeader ? t : { ...t, checked: checkedIds.has(t.id) });
};

function Card({ emoji, title, children, onEmojiClick }: {
  emoji: string; title: string; children: React.ReactNode; onEmojiClick?: () => void;
}) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.45)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)', border: '1px solid rgba(255,255,255,0.7)', boxShadow: '0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.8)', height: '540px', overflow: 'hidden' }} className="rounded-3xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-base transition-all ${onEmojiClick ? 'cursor-pointer select-none' : ''}`} style={{ filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.15))' }} onClick={onEmojiClick}>{emoji}</span>
        <span className="text-xs font-bold tracking-widest uppercase" style={{ fontFamily: '"stolzl", sans-serif', fontWeight: 700, color: '#6b7280' }}>{title}</span>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
    </div>
  );
}

function CheckItem({ id, text, checked, onChange, onDelete, onDelegate }: {
  id: string; text: string; checked: boolean;
  onChange: (id: string, checked: boolean) => void;
  onDelete?: (id: string) => void;
  onDelegate?: () => void;
}) {
  return (
    <div className="flex items-start gap-3 group">
      <div onClick={() => onChange(id, !checked)} className="mt-0.5 shrink-0 w-4 h-4 rounded flex items-center justify-center transition-colors cursor-pointer" style={{ background: checked ? '#fbcdad' : 'rgba(255,255,255,0.6)', border: checked ? '1.5px solid #fbcdad' : '1.5px solid rgba(0,0,0,0.15)' }}>
        {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#333" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>
      <span className="flex-1 text-sm leading-snug">
        {(() => {
          const supplierUrl = SUPPLIER_LINKS[text.toLowerCase()];
          if (supplierUrl && !checked) {
            return (
              <a href={supplierUrl} target={supplierUrl.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="font-medium underline underline-offset-2" style={{ color: '#c8926a' }} onClick={e => e.stopPropagation()}>{text}</a>
            );
          }
          return (
            <span onClick={() => onChange(id, !checked)} className={`cursor-pointer transition-colors ${checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>{text}</span>
          );
        })()}
      </span>
      {onDelegate && (
        <button onClick={onDelegate} className="shrink-0 transition-opacity leading-none mt-0.5 opacity-40 hover:opacity-100" style={{ fontSize: '13px', lineHeight: 1 }} aria-label="Ask Claude" title="Ask Claude">🤖</button>
      )}
      {onDelete && (
        <button onClick={() => onDelete(id)} className="shrink-0 transition-colors leading-none mt-0.5" style={{ fontSize: '16px', lineHeight: 1, color: '#ccc' }} onTouchStart={e => (e.currentTarget.style.color = '#ef4444')} onTouchEnd={e => (e.currentTarget.style.color = '#ccc')} aria-label="Delete task">×</button>
      )}
    </div>
  );
}

function RosterRow({ shift, isToday, isHighlighted, taskCount, onAdd, onSelectDay }: {
  shift: Shift; isToday: boolean; isHighlighted: boolean; taskCount: number;
  onAdd: (date: string, text: string) => Promise<void>;
  onSelectDay: (date: string) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [taskText, setTaskText] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const openInput = (e: React.MouseEvent) => { e.stopPropagation(); setIsAdding(true); setTimeout(() => inputRef.current?.focus(), 320); };
  const close = () => { setIsAdding(false); setTaskText(''); };
  const submit = async () => { if (!taskText.trim()) return; setSaving(true); await onAdd(shift.date, taskText); setSaving(false); close(); };

  return (
    <div className={`relative overflow-hidden rounded-xl ${isHighlighted ? 'border' : 'bg-white/30'}`} style={isHighlighted ? { minHeight: '52px', background: 'rgba(251,205,173,0.12)', borderColor: '#fbcdad' } : { minHeight: '52px' }}>
      <div className="absolute inset-0 flex items-center justify-between py-2 px-3 transition-transform duration-300 ease-in-out cursor-pointer" style={{ transform: isAdding ? 'translateX(-100%)' : 'translateX(0)' }} onClick={() => onSelectDay(shift.date)}>
        <div>
          <span className={`text-sm font-semibold ${shift.working ? 'text-gray-800' : 'text-gray-400'}`}>{shift.label}{isToday && <span className="ml-2 text-xs font-medium text-gray-400">TODAY</span>}</span>
          {shift.working && shift.area && <p className="text-xs text-gray-400 mt-0.5">{shift.area}</p>}
          {shift.working && shift.comment && <p className="text-xs text-gray-400 mt-0.5">{shift.comment}</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${shift.working ? 'text-gray-500' : 'text-gray-300'}`}>{shift.working ? `${shift.start} – ${shift.end}` : 'Not working'}</span>
          <button onClick={() => onSelectDay(shift.date)} className="flex items-center justify-center rounded-full font-bold transition-all hover:scale-110" style={{ width: '22px', height: '22px', background: taskCount > 0 ? '#fbcdad' : 'rgba(0,0,0,0.06)', color: taskCount > 0 ? '#333' : '#aaa', flexShrink: 0, fontSize: '11px' }} title={`${taskCount} task${taskCount !== 1 ? 's' : ''}`}>{taskCount}</button>
          <button onClick={openInput} className="transition-colors text-xl leading-none font-light text-gray-300 hover:text-gray-400" aria-label="Add task">+</button>
        </div>
      </div>
      <div className="absolute inset-0 flex items-center gap-2 py-2 px-3 transition-transform duration-300 ease-in-out" style={{ transform: isAdding ? 'translateX(0)' : 'translateX(100%)' }}>
        <span className="text-xs font-semibold shrink-0 text-gray-500">{shift.label.split(' ')[0]}</span>
        <input ref={inputRef} value={taskText} onChange={e => setTaskText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); }} placeholder="Add a task..." className="flex-1 min-w-0 text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.08)' }} />
        <button onClick={submit} disabled={saving || !taskText.trim()} className="text-xs disabled:opacity-40 px-3 py-1.5 rounded-lg font-semibold transition-colors shrink-0" style={{ background: '#fbcdad', color: '#333' }}>{saving ? '...' : 'Add'}</button>
        <button onClick={close} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none shrink-0">✕</button>
      </div>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [braindump, setBraindump] = useState('');
  const [showPromote, setShowPromote] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [nextActions, setNextActions] = useState(['', '', '']);
  const [promoting, setPromoting] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [weekTasks, setWeekTasks] = useState<Record<string, WeekDay>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState(false);
  const [addingActionFor, setAddingActionFor] = useState<string | null>(null);
  const [newActionText, setNewActionText] = useState('');
  const [serverState, setServerState] = useState<Record<string, string[]>>({});
  const [claudePanel, setClaudePanel] = useState<ClaudePanelState | null>(null);
  const [claudeInput, setClaudeInput] = useState('');
  const [claudeLoading, setClaudeLoading] = useState(false);
  const claudeMessagesEndRef = useRef<HTMLDivElement>(null);

  const todayStr = data?.todayStr ?? '';

  const fetchServerState = async (): Promise<Record<string, string[]>> => {
    try {
      const d = await fetch('/api/checked-state').then(r => r.json());
      const state = d.state || {};
      setServerState(state);
      return state;
    } catch { return {}; }
  };

  const fetchDashboard = async (state: Record<string, string[]>) => {
    const res = await fetch('/api/dashboard');
    if (res.status === 401) { window.location.href = '/login'; return; }
    const d = await res.json();
    setData({ ...d, dailyTasks: applyServerChecked(d.dailyTasks, d.todayStr, state) });
  };

  const fetchWeekTasks = async (state: Record<string, string[]>) => {
    const d = await fetch('/api/week-tasks').then(r => r.json());
    const enriched: Record<string, WeekDay> = {};
    for (const [date, day] of Object.entries(d.days as Record<string, WeekDay>)) {
      enriched[date] = { ...day, tasks: applyServerChecked(day.tasks, date, state) };
    }
    setWeekTasks(enriched);
  };

  useEffect(() => {
    const init = async () => {
      const [rosterData, state] = await Promise.all([
        fetch('/api/roster').then(r => r.json()).catch(() => ({ shifts: [] })),
        fetchServerState(),
      ]);
      setShifts(rosterData.shifts || []);
      await Promise.all([fetchDashboard(state).catch(() => {}), fetchWeekTasks(state).catch(() => {})]);
      setLoading(false);
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading) return;
    const interval = setInterval(async () => {
      const state = await fetchServerState();
      setData(prev => prev ? { ...prev, dailyTasks: applyServerChecked(prev.dailyTasks, prev.todayStr, state) } : prev);
      setWeekTasks(prev => {
        const updated: Record<string, WeekDay> = {};
        for (const [date, day] of Object.entries(prev)) updated[date] = { ...day, tasks: applyServerChecked(day.tasks, date, state) };
        return updated;
      });
    }, 30000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    if (claudePanel) setTimeout(() => claudeMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [claudePanel?.messages.length, claudePanel]);

  const syncCheckedState = (blockId: string, date: string, checked: boolean) => {
    setServerState(prev => {
      const next = { ...prev };
      if (checked) { next[date] = [...new Set([...(next[date] || []), blockId])]; }
      else { next[date] = (next[date] || []).filter(id => id !== blockId); if (!next[date].length) delete next[date]; }
      return next;
    });
    fetch('/api/checked-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, date, checked }) }).catch(() => {});
  };

  const handleSelectDay = (date: string) => setSelectedDate(prev => prev === date ? null : date);

  const handleDeleteTask = async (blockId: string, section: 'daily' | 'week', date?: string) => {
    if (section === 'daily') setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.filter(t => t.id !== blockId) } : prev);
    else if (section === 'week' && date) setWeekTasks(prev => ({ ...prev, [date]: { ...prev[date], count: prev[date].count - 1, tasks: prev[date].tasks.filter(t => t.id !== blockId) } }));
    await fetch('/api/delete-task', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId }) });
  };

  const handleAddTask = async (date: string, text: string) => {
    await fetch('/api/add-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, text }) });
    const state = await fetchServerState();
    await fetchWeekTasks(state);
    if (date === todayStr) await fetchDashboard(state);
  };

  const handleClaudeChat = async (panel: ClaudePanelState, userMessage: string) => {
    const newMsgs: ClaudeMessage[] = [...panel.messages, { role: 'user', content: userMessage }];
    setClaudePanel(prev => prev ? { ...prev, messages: newMsgs } : prev);
    setClaudeInput('');
    setClaudeLoading(true);
    try {
      const res = await fetch('/api/claude-assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: newMsgs, projectName: panel.projectName, actionText: panel.actionText }) });
      const d = await res.json();
      setClaudePanel(prev => prev ? { ...prev, messages: [...newMsgs, { role: 'assistant', content: d.content }] } : prev);
    } catch {
      setClaudePanel(prev => prev ? { ...prev, messages: [...newMsgs, { role: 'assistant', content: 'Something went wrong. Check ANTHROPIC_API_KEY is set in Vercel.' }] } : prev);
    }
    setClaudeLoading(false);
  };

  const openClaudePanel = (project: Project, todo: Todo) => {
    const firstMsgs: ClaudeMessage[] = [{ role: 'user', content: `Help me with this action item: "${todo.text}"` }];
    setClaudePanel({ projectId: project.id, projectName: project.name, actionText: todo.text, messages: firstMsgs });
    setClaudeInput('');
    setClaudeLoading(true);
    fetch('/api/claude-assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: firstMsgs, projectName: project.name, actionText: todo.text }) })
      .then(r => r.json())
      .then(d => { setClaudePanel(prev => prev ? { ...prev, messages: [...firstMsgs, { role: 'assistant', content: d.content }] } : prev); setClaudeLoading(false); })
      .catch(() => { setClaudePanel(prev => prev ? { ...prev, messages: [...firstMsgs, { role: 'assistant', content: 'Could not reach Claude. Check ANTHROPIC_API_KEY in Vercel.' }] } : prev); setClaudeLoading(false); });
  };

  const STATUS_CYCLE = ['In Progress', 'Blocked', 'On Hold', 'Done'];
  const handleStatusChange = async (projectId: string, currentStatus: string) => {
    const idx = STATUS_CYCLE.indexOf(currentStatus);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setData(prev => prev ? { ...prev, projects: prev.projects.map(p => p.id === projectId ? { ...p, status: next } : p) } : prev);
    if (next === 'Done') setTimeout(() => setData(prev => prev ? { ...prev, projects: prev.projects.filter(p => p.id !== projectId) } : prev), 600);
    await fetch('/api/project-status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, status: next }) });
  };

  const handleAddProjectAction = async (projectId: string, text: string) => {
    if (!text.trim()) return;
    await fetch('/api/add-project-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, text: text.trim() }) });
    const state = await fetchServerState();
    await fetchDashboard(state);
    setAddingActionFor(null);
    setNewActionText('');
  };

  const toggleTodo = async (blockId: string, checked: boolean, section: 'daily' | 'project' | 'personal' | 'week', projectId?: string, date?: string) => {
    if (blockId.startsWith('header-')) return;
    if (section === 'daily') {
      setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.map(t => t.id === blockId ? { ...t, checked } : t) } : prev);
      syncCheckedState(blockId, todayStr, checked);
    } else if (section === 'week' && date) {
      setWeekTasks(prev => ({ ...prev, [date]: { ...prev[date], tasks: prev[date].tasks.map(t => t.id === blockId ? { ...t, checked } : t) } }));
      syncCheckedState(blockId, date, checked);
    } else if (section === 'project' && projectId) {
      setData(prev => prev ? { ...prev, projects: prev.projects.map(p => p.id === projectId ? { ...p, todos: p.todos.map(t => t.id === blockId ? { ...t, checked } : t) } : p) } : prev);
      await fetch('/api/todos', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, checked }) });
    } else if (section === 'personal') {
      setData(prev => prev ? { ...prev, personalTodos: prev.personalTodos.map(t => t.id === blockId ? { ...t, checked } : t) } : prev);
      await fetch('/api/todos', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, checked }) });
    }
  };

  const handlePromote = async () => {
    if (!projectName.trim()) return;
    setPromoting(true);
    await fetch('/api/braindump', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectName, nextActions, ideaText: braindump }) });
    const state = await fetchServerState();
    await fetchDashboard(state);
    setBraindump(''); setProjectName(''); setNextActions(['', '', '']); setShowPromote(false); setPromoting(false);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #fef9f0 50%, #f0fff4 100%)' }}>
      <p className="text-gray-400 text-xs tracking-widest uppercase animate-pulse">Loading...</p>
    </div>
  );

  if (!data) return null;

  const isViewingOtherDay = selectedDate !== null && selectedDate !== todayStr;
  const displayedTasks = isViewingOtherDay ? (weekTasks[selectedDate!]?.tasks ?? []) : data.dailyTasks;
  const selectedShift = selectedDate ? shifts.find(s => s.date === selectedDate) : null;
  const displayDayLabel = isViewingOtherDay && selectedShift ? selectedShift.label : null;
  const dailyTasks = displayedTasks.filter(t => !t.isHeader);
  const dailyDone = dailyTasks.filter(t => t.checked).length;
  const projectsDone = data.projects.flatMap(p => p.todos).filter(t => t.checked).length;
  const projectsTotal = data.projects.flatMap(p => p.todos).length;

  return (
    <div className="min-h-screen text-gray-900" style={{ background: 'linear-gradient(135deg, #e8eeff 0%, #fff8f0 40%, #f0fdf4 100%)' }}>
      <div style={{ position: 'fixed', top: '-10%', right: '-5%', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(251,146,60,0.18) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '-10%', left: '-5%', width: '500px', height: '500px', background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', top: '40%', left: '30%', width: '300px', height: '300px', background: 'radial-gradient(circle, rgba(34,197,94,0.08) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />

      <div className="max-w-5xl mx-auto px-5 pt-8 pb-4 flex items-center justify-between relative">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-gray-900" style={{ fontFamily: '"bodoni-pt-variable", "Bodoni 72", "Bodoni MT", Georgia, serif', fontWeight: 700, fontStyle: 'italic', fontVariationSettings: "'opsz' 18, 'wght' 700" }}>
            TIGER <span style={{ color: '#fbcdad' }}>OS</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest" style={{ fontFamily: '"stolzl", sans-serif' }}>{data.dateStr}</p>
          <p className="text-xs text-gray-400 mt-0.5 uppercase tracking-widest" style={{ fontFamily: '"stolzl", sans-serif' }}>{data.weather}</p>
        </div>
        <img src="/logo.png" alt="G'Day Tiger" style={{ width: '56px', height: '56px', objectFit: 'contain', flexShrink: 0, filter: 'drop-shadow(0px 4px 12px rgba(0,0,0,0.3))' }} />
      </div>

      <div className="max-w-5xl mx-auto px-5 pb-10 grid grid-cols-1 md:grid-cols-2 gap-4 relative">

        {/* DAILY TO DO */}
        <Card emoji="⚡" title={displayDayLabel ? `Tasks — ${displayDayLabel}` : 'Daily To Do'} onEmojiClick={() => setDeleteMode(d => !d)}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400 uppercase tracking-widest">{dailyDone}/{dailyTasks.length} Done</span>
            {isViewingOtherDay && <button onClick={() => setSelectedDate(null)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">← Back to today</button>}
          </div>
          <div className="space-y-3">
            {displayedTasks.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No tasks {isViewingOtherDay ? 'this day' : 'today'} 🎉</p>
            ) : (
              displayedTasks.map(task => task.isHeader ? (
                <div key={task.id} className="pt-2 pb-0.5">
                  <span style={{ fontFamily: '"stolzl", sans-serif', fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#aaa' }}>{task.text.toUpperCase()}</span>
                </div>
              ) : (
                <CheckItem key={task.id} id={task.id} text={task.text} checked={task.checked}
                  onChange={(id, checked) => toggleTodo(id, checked, isViewingOtherDay ? 'week' : 'daily', undefined, isViewingOtherDay ? selectedDate! : undefined)}
                  onDelete={deleteMode ? (id) => handleDeleteTask(id, isViewingOtherDay ? 'week' : 'daily', isViewingOtherDay ? selectedDate! : undefined) : undefined} />
              ))
            )}
          </div>
        </Card>

        {/* THE WEEK AHEAD */}
        <Card emoji="📅" title="The Week Ahead">
          <div className="space-y-2">
            {shifts.length === 0 ? <p className="text-sm text-gray-400 italic">No shifts found</p> : (
              shifts.map(shift => (
                <RosterRow key={shift.date} shift={shift} isToday={shift.date === todayStr} isHighlighted={selectedDate ? shift.date === selectedDate : shift.date === todayStr} taskCount={weekTasks[shift.date]?.count ?? 0} onAdd={handleAddTask} onSelectDay={handleSelectDay} />
              ))
            )}
          </div>
        </Card>

        {/* ONGOING PROJECTS */}
        <Card emoji="🎯" title="Ongoing Projects">
          <span className="text-xs text-gray-400 -mt-2">{projectsDone}/{projectsTotal} actions done</span>
          <div className="space-y-5">
            {data.projects.length === 0 ? <p className="text-sm text-gray-400 italic">No active projects</p> : (
              data.projects.map(project => (
                <div key={project.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-gray-900 flex-1">{project.name}</span>
                    <button onClick={() => handleStatusChange(project.id, project.status)} title="Click to cycle status" className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors cursor-pointer ${project.status === 'In Progress' ? 'bg-blue-100 text-blue-600 hover:bg-blue-200' : project.status === 'Blocked' ? 'bg-red-100 text-red-600 hover:bg-red-200' : project.status === 'On Hold' ? 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200' : 'bg-green-100 text-green-600 hover:bg-green-200'}`}>{project.status}</button>
                  </div>
                  {project.todos.length === 0 ? <p className="text-xs text-gray-400 italic ml-1">No actions set</p> : (
                    <div className="space-y-2">
                      {project.todos.map(todo => (
                        <CheckItem key={todo.id} id={todo.id} text={todo.text} checked={todo.checked} onChange={(id, checked) => toggleTodo(id, checked, 'project', project.id)} onDelegate={() => openClaudePanel(project, todo)} />
                      ))}
                    </div>
                  )}
                  {addingActionFor === project.id ? (
                    <div className="flex gap-2 mt-2">
                      <input value={newActionText} onChange={e => setNewActionText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddProjectAction(project.id, newActionText); if (e.key === 'Escape') { setAddingActionFor(null); setNewActionText(''); } }} placeholder="New action..." autoFocus className="flex-1 min-w-0 text-xs px-3 py-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.08)' }} />
                      <button onClick={() => handleAddProjectAction(project.id, newActionText)} disabled={!newActionText.trim()} className="text-xs disabled:opacity-40 px-3 py-1.5 rounded-lg font-semibold transition-colors shrink-0" style={{ background: '#fbcdad', color: '#333' }}>Add</button>
                      <button onClick={() => { setAddingActionFor(null); setNewActionText(''); }} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none shrink-0">&times;</button>
                    </div>
                  ) : (
                    <button onClick={() => { setAddingActionFor(project.id); setNewActionText(''); }} className="mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors">+ Add action</button>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>

        {/* BRAIN DUMP */}
        <Card emoji="🧠" title="Brain Dump">
          {!showPromote ? (
            <div className="space-y-3">
              <textarea value={braindump} onChange={e => setBraindump(e.target.value)} placeholder="Drop an idea..." style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.8)' }} className="w-full rounded-xl px-3 py-2 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" rows={4} />
              {braindump.trim() && (
                <button onClick={() => { setProjectName(braindump.trim()); setShowPromote(true); }} className="text-xs px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition-colors shadow-sm" style={{ background: '#fbcdad', color: '#333' }}>Move to Projects →</button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-400 italic">&ldquo;{braindump}&rdquo;</p>
              <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Project name" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.8)' }} className="w-full rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" />
              {nextActions.map((action, i) => (
                <input key={i} value={action} onChange={e => { const a = [...nextActions]; a[i] = e.target.value; setNextActions(a); }} placeholder={`Next action ${i + 1}`} style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.8)' }} className="w-full rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" />
              ))}
              <div className="flex gap-2 pt-1">
                <button onClick={handlePromote} disabled={promoting || !projectName.trim()} className="text-xs disabled:opacity-40 px-4 py-2 rounded-lg font-bold uppercase tracking-wider transition-colors shadow-sm" style={{ background: '#fbcdad', color: '#333' }}>{promoting ? 'Creating...' : 'Create Project'}</button>
                <button onClick={() => { setShowPromote(false); setProjectName(''); setNextActions(['', '', '']); }} className="text-xs text-gray-400 hover:text-gray-600 px-3 py-2 transition-colors font-bold uppercase tracking-wider">Cancel</button>
              </div>
            </div>
          )}
        </Card>

        {/* PERSONAL TO DO */}
        <Card emoji="👤" title="Personal To Do">
          <div className="space-y-3">
            {data.personalTodos.length === 0 ? <p className="text-sm text-gray-400 italic">Nothing here</p> : (
              data.personalTodos.map(todo => (
                <CheckItem key={todo.id} id={todo.id} text={todo.text} checked={todo.checked} onChange={(id, checked) => toggleTodo(id, checked, 'personal')} />
              ))
            )}
          </div>
        </Card>

      </div>

      {/* CLAUDE CHAT DRAWER */}
      {claudePanel && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col" style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', maxHeight: '52vh' }}>
          <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <span className="text-base">🤖</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#6b7280' }}>Claude</p>
              <p className="text-xs text-gray-400 truncate">{claudePanel.projectName} — {claudePanel.actionText}</p>
            </div>
            <button onClick={() => { setClaudePanel(null); setClaudeInput(''); }} className="text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
            {claudePanel.messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-prose rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'text-gray-800' : 'text-gray-800 bg-white'}`} style={m.role === 'user' ? { background: '#fbcdad' } : { border: '1px solid rgba(0,0,0,0.07)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                  {m.content}
                </div>
              </div>
            ))}
            {claudeLoading && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-4 py-2.5 text-sm text-gray-400 animate-pulse bg-white" style={{ border: '1px solid rgba(0,0,0,0.07)' }}>Thinking...</div>
              </div>
            )}
            <div ref={claudeMessagesEndRef} />
          </div>
          <div className="flex gap-2 px-5 py-3 shrink-0" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <input value={claudeInput} onChange={e => setClaudeInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && claudeInput.trim() && !claudeLoading) handleClaudeChat(claudePanel, claudeInput); }} placeholder="Ask Claude anything about this task..." className="flex-1 min-w-0 text-sm px-4 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)' }} />
            <button onClick={() => { if (claudeInput.trim() && !claudeLoading) handleClaudeChat(claudePanel, claudeInput); }} disabled={claudeLoading || !claudeInput.trim()} className="text-sm disabled:opacity-40 px-4 py-2.5 rounded-xl font-semibold transition-colors shrink-0" style={{ background: '#fbcdad', color: '#333' }}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}