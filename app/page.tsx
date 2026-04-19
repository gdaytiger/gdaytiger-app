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

const SUPPLIER_LINKS: Record<string, string> = {
  'dench': 'https://denchbakers.cybakeshop.com.au/home',
  'seven seeds': 'https://sevenseedswholesale.com.au/account/',
  'noisette': 'https://connect.noisette.com.au/',
  'redimilk': 'tel:0397024262',
  'candied': `mailto:hello@candiedbakery.com.au?subject=${encodeURIComponent("G'DAY TIGER Order")}&body=${encodeURIComponent("Hey Guys,\n\nCan we please get\nx Paninis\nx Marshmallow Cookies\nx Candied Pies\nx Brownie Slab\nx Maple Pecan\n\nThanks,\nJono")}`,
};

const getStorageKey = (date?: string) =>
  `gdaytiger-checked-${date ?? new Date().toISOString().split('T')[0]}`;

const loadCheckedState = (date?: string): Record<string, boolean> => {
  try {
    const stored = localStorage.getItem(getStorageKey(date));
    return stored ? JSON.parse(stored) : {};
  } catch { return {}; }
};

const saveCheckedState = (state: Record<string, boolean>, date?: string) => {
  try {
    localStorage.setItem(getStorageKey(date), JSON.stringify(state));
  } catch {}
};

const applyChecked = (todos: Todo[], state: Record<string, boolean>): Todo[] =>
  todos.map(t => t.isHeader ? t : { ...t, checked: state[t.id] !== undefined ? state[t.id] : t.checked });

function Card({ emoji, title, children, onEmojiClick, emojiActive }: {
  emoji: string; title: string; children: React.ReactNode;
  onEmojiClick?: () => void;
  emojiActive?: boolean;
}) {
  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.45)',
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      border: '1px solid rgba(255, 255, 255, 0.7)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.8)',
    }} className="rounded-3xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span
          className={`text-base transition-all ${onEmojiClick ? 'cursor-pointer select-none' : ''}`}
          style={{
            filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.15))',
            background: 'transparent',
          }}
          onClick={onEmojiClick}
        >{emoji}</span>
        <span className="text-xs font-bold tracking-widest uppercase" style={{ fontFamily: '"stolzl", sans-serif', fontWeight: 700, color: '#fbcdad', textShadow: '0px 2px 6px rgba(0,0,0,0.12)' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function CheckItem({
  id, text, checked, onChange, onDelete
}: {
  id: string; text: string; checked: boolean;
  onChange: (id: string, checked: boolean) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-3 group">
      <div
        onClick={() => onChange(id, !checked)}
        className="mt-0.5 shrink-0 w-4 h-4 rounded flex items-center justify-center transition-colors cursor-pointer"
        style={{
          background: checked ? '#fbcdad' : 'rgba(255,255,255,0.6)',
          border: checked ? '1.5px solid #fbcdad' : '1.5px solid rgba(0,0,0,0.15)',
        }}
      >
        {checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="#333" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
      <span className="flex-1 text-sm leading-snug">
        {(() => {
          const supplierUrl = SUPPLIER_LINKS[text.toLowerCase()];
          if (supplierUrl && !checked) {
            return (
              <a
                href={supplierUrl}
                target={supplierUrl.startsWith('http') ? '_blank' : undefined}
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2"
                style={{ color: '#c8926a' }}
                onClick={e => e.stopPropagation()}
              >
                {text}
              </a>
            );
          }
          return (
            <span
              onClick={() => onChange(id, !checked)}
              className={`cursor-pointer transition-colors ${checked ? 'line-through text-gray-400' : 'text-gray-800'}`}
            >
              {text}
            </span>
          );
        })()}
      </span>
      {onDelete && (
        <button
          onClick={() => onDelete(id)}
          className="shrink-0 transition-colors leading-none mt-0.5"
          style={{ fontSize: '16px', lineHeight: 1, color: '#ccc' }}
          onTouchStart={e => (e.currentTarget.style.color = '#ef4444')}
          onTouchEnd={e => (e.currentTarget.style.color = '#ccc')}
          aria-label="Delete task"
        >
          ×
        </button>
      )}
    </div>
  );
}

function RosterRow({
  shift,
  isToday,
  isHighlighted,
  taskCount,
  onAdd,
  onSelectDay,
}: {
  shift: Shift;
  isToday: boolean;
  isHighlighted: boolean;
  taskCount: number;
  onAdd: (date: string, text: string) => Promise<void>;
  onSelectDay: (date: string) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [taskText, setTaskText] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const openInput = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsAdding(true);
    setTimeout(() => inputRef.current?.focus(), 320);
  };

  const close = () => {
    setIsAdding(false);
    setTaskText('');
  };

  const submit = async () => {
    if (!taskText.trim()) return;
    setSaving(true);
    await onAdd(shift.date, taskText);
    setSaving(false);
    close();
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl ${isHighlighted ? 'border' : 'bg-white/30'}`}
      style={isHighlighted ? { minHeight: '52px', background: 'rgba(251,205,173,0.12)', borderColor: '#fbcdad' } : { minHeight: '52px' }}
    >
      {/* Normal row — slides left out */}
      <div
        className="absolute inset-0 flex items-center justify-between py-2 px-3 transition-transform duration-300 ease-in-out cursor-pointer"
        style={{ transform: isAdding ? 'translateX(-100%)' : 'translateX(0)' }}
        onClick={() => onSelectDay(shift.date)}
      >
        <div>
          <span className={`text-sm font-semibold ${shift.working ? 'text-gray-800' : 'text-gray-400'}`}>
            {shift.label}
            {isToday && <span className="ml-2 text-xs font-medium text-gray-400">TODAY</span>}
          </span>
          {shift.working && shift.area && <p className="text-xs text-gray-400 mt-0.5">{shift.area}</p>}
          {shift.working && shift.comment && <p className="text-xs text-gray-400 mt-0.5">{shift.comment}</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${shift.working ? 'text-gray-500' : 'text-gray-300'}`}>
            {shift.working ? `${shift.start} – ${shift.end}` : 'Not working'}
          </span>
          {/* Task count circle */}
          <button
            onClick={() => onSelectDay(shift.date)}
            className="flex items-center justify-center rounded-full font-bold transition-all hover:scale-110"
            style={{
              width: '22px',
              height: '22px',
              background: taskCount > 0 ? '#fbcdad' : 'rgba(0,0,0,0.06)',
              color: taskCount > 0 ? '#333' : '#aaa',
              flexShrink: 0,
              fontSize: '11px',
            }}
            title={`${taskCount} task${taskCount !== 1 ? 's' : ''}`}
          >
            {taskCount}
          </button>
          <button
            onClick={openInput}
            className="transition-colors text-xl leading-none font-light text-gray-300 hover:text-gray-400"
            aria-label="Add task"
          >
            +
          </button>
        </div>
      </div>

      {/* Input row — slides in from right */}
      <div
        className="absolute inset-0 flex items-center gap-2 py-2 px-3 transition-transform duration-300 ease-in-out"
        style={{ transform: isAdding ? 'translateX(0)' : 'translateX(100%)' }}
      >
        <span className="text-xs font-semibold shrink-0 text-gray-500">
          {shift.label.split(' ')[0]}
        </span>
        <input
          ref={inputRef}
          value={taskText}
          onChange={e => setTaskText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); }}
          placeholder="Add a task..."
          className="flex-1 min-w-0 text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all"
          style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.08)' }}
        />
        <button
          onClick={submit}
          disabled={saving || !taskText.trim()}
          className="text-xs disabled:opacity-40 px-3 py-1.5 rounded-lg font-semibold transition-colors shrink-0"
          style={{ background: '#fbcdad', color: '#333' }}
        >
          {saving ? '...' : 'Add'}
        </button>
        <button onClick={close} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none shrink-0">
          ✕
        </button>
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

  const todayStr = data?.todayStr ?? '';

  const fetchDashboard = async () => {
    const res = await fetch('/api/dashboard');
    if (res.status === 401) { window.location.href = '/login'; return; }
    const d = await res.json();
    const state = loadCheckedState();
    setData({
      ...d,
      dailyTasks: applyChecked(d.dailyTasks, state),
      projects: d.projects.map((p: Project) => ({ ...p, todos: applyChecked(p.todos, state) })),
      personalTodos: applyChecked(d.personalTodos, state),
    });
  };

  const fetchWeekTasks = async () => {
    const d = await fetch('/api/week-tasks').then(r => r.json());
    const enriched: Record<string, WeekDay> = {};
    for (const [date, day] of Object.entries(d.days as Record<string, WeekDay>)) {
      // Each day uses its own date-specific storage key so checks don't bleed across weeks
      const state = loadCheckedState(date);
      enriched[date] = { ...day, tasks: applyChecked(day.tasks, state) };
    }
    setWeekTasks(enriched);
  };

  useEffect(() => {
    fetch('/api/roster')
      .then(r => r.json())
      .then(d => setShifts(d.shifts || []));
    fetchDashboard()
      .then(() => setLoading(false))
      .catch(() => setLoading(false));
    fetchWeekTasks().catch(() => {});
  }, []);

  const handleSelectDay = (date: string) => {
    setSelectedDate(prev => prev === date ? null : date);
  };

  const handleDeleteTask = async (blockId: string, section: 'daily' | 'week', date?: string) => {
    // Optimistic UI update
    if (section === 'daily') {
      setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.filter(t => t.id !== blockId) } : prev);
    } else if (section === 'week' && date) {
      setWeekTasks(prev => ({
        ...prev,
        [date]: { ...prev[date], count: prev[date].count - 1, tasks: prev[date].tasks.filter(t => t.id !== blockId) },
      }));
    }
    await fetch('/api/delete-task', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockId }),
    });
  };

  const handleAddTask = async (date: string, text: string) => {
    await fetch('/api/add-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, text }),
    });
    await fetchWeekTasks();
    if (date === todayStr) await fetchDashboard();
  };

  const toggleTodo = async (
    blockId: string,
    checked: boolean,
    section: 'daily' | 'project' | 'personal' | 'week',
    projectId?: string,
    date?: string,
  ) => {
    if (blockId.startsWith('header-')) return;
    const storageDate = section === 'week' ? date : undefined;
    const state = loadCheckedState(storageDate);
    state[blockId] = checked;
    saveCheckedState(state, storageDate);

    if (section === 'daily') {
      setData(prev => prev ? { ...prev, dailyTasks: prev.dailyTasks.map(t => t.id === blockId ? { ...t, checked } : t) } : prev);
    } else if (section === 'week' && date) {
      setWeekTasks(prev => ({
        ...prev,
        [date]: { ...prev[date], tasks: prev[date].tasks.map(t => t.id === blockId ? { ...t, checked } : t) },
      }));
    } else if (section === 'project' && projectId) {
      setData(prev => prev ? {
        ...prev,
        projects: prev.projects.map(p => p.id === projectId ? {
          ...p, todos: p.todos.map(t => t.id === blockId ? { ...t, checked } : t),
        } : p),
      } : prev);
    } else if (section === 'personal') {
      setData(prev => prev ? { ...prev, personalTodos: prev.personalTodos.map(t => t.id === blockId ? { ...t, checked } : t) } : prev);
    }

    await fetch('/api/todos', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockId, checked }),
    });
  };

  const handlePromote = async () => {
    if (!projectName.trim()) return;
    setPromoting(true);
    await fetch('/api/braindump', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName, nextActions, ideaText: braindump }),
    });
    await fetchDashboard();
    setBraindump('');
    setProjectName('');
    setNextActions(['', '', '']);
    setShowPromote(false);
    setPromoting(false);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{
      background: 'linear-gradient(135deg, #f0f4ff 0%, #fef9f0 50%, #f0fff4 100%)',
    }}>
      <p className="text-gray-400 text-xs tracking-widest uppercase animate-pulse">Loading...</p>
    </div>
  );

  if (!data) return null;

  // Determine which tasks to show in Daily To Do
  const isViewingOtherDay = selectedDate !== null && selectedDate !== todayStr;
  const displayedTasks = isViewingOtherDay
    ? (weekTasks[selectedDate!]?.tasks ?? [])
    : data.dailyTasks;

  // Label for the selected day
  const selectedShift = selectedDate ? shifts.find(s => s.date === selectedDate) : null;
  const displayDayLabel = isViewingOtherDay && selectedShift ? selectedShift.label : null;

  const dailyDone = displayedTasks.filter(t => t.checked).length;
  const projectsDone = data.projects.flatMap(p => p.todos).filter(t => t.checked).length;
  const projectsTotal = data.projects.flatMap(p => p.todos).length;

  return (
    <div className="min-h-screen text-gray-900" style={{
      background: 'linear-gradient(135deg, #e8eeff 0%, #fff8f0 40%, #f0fdf4 100%)',
    }}>
      <div style={{ position: 'fixed', top: '-10%', right: '-5%', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(251,146,60,0.18) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '-10%', left: '-5%', width: '500px', height: '500px', background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', top: '40%', left: '30%', width: '300px', height: '300px', background: 'radial-gradient(circle, rgba(34,197,94,0.08) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />

      {/* Header */}
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

      {/* Grid */}
      <div className="max-w-5xl mx-auto px-5 pb-10 grid grid-cols-1 md:grid-cols-2 gap-4 relative">

        {/* DAILY TO DO */}
        <Card emoji="⚡" title={displayDayLabel ? `Tasks — ${displayDayLabel}` : 'Daily To Do'} onEmojiClick={() => setDeleteMode(d => !d)} emojiActive={deleteMode}>
          <div className="flex items-center justify-between -mt-2">
            <span className="text-xs text-gray-400">{dailyDone}/{displayedTasks.length} done</span>
            {isViewingOtherDay && (
              <button
                onClick={() => setSelectedDate(null)}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                ← Back to today
              </button>
            )}
          </div>
          <div className="space-y-3">
            {displayedTasks.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No tasks {isViewingOtherDay ? 'this day' : 'today'} 🎉</p>
            ) : (
              displayedTasks.map(task => task.isHeader ? (
                <div key={task.id} className="pt-1 pb-0.5">
                  <span className="text-xs font-bold tracking-widest uppercase" style={{ fontFamily: '"stolzl", sans-serif', color: '#bbb' }}>
                    {task.text}
                  </span>
                </div>
              ) : (
                <CheckItem
                  key={task.id}
                  id={task.id}
                  text={task.text}
                  checked={task.checked}
                  onChange={(id, checked) => toggleTodo(
                    id, checked,
                    isViewingOtherDay ? 'week' : 'daily',
                    undefined,
                    isViewingOtherDay ? selectedDate! : undefined
                  )}
                  onDelete={deleteMode ? (id) => handleDeleteTask(
                    id,
                    isViewingOtherDay ? 'week' : 'daily',
                    isViewingOtherDay ? selectedDate! : undefined
                  ) : undefined}
                />
              ))
            )}
          </div>
        </Card>

        {/* THE WEEK AHEAD */}
        <Card emoji="📅" title="The Week Ahead">
          <div className="space-y-2">
            {shifts.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No shifts found</p>
            ) : (
              shifts.map(shift => (
                <RosterRow
                  key={shift.date}
                  shift={shift}
                  isToday={shift.date === todayStr}
                  isHighlighted={selectedDate ? shift.date === selectedDate : shift.date === todayStr}
                  taskCount={weekTasks[shift.date]?.count ?? 0}
                  onAdd={handleAddTask}
                  onSelectDay={handleSelectDay}
                />
              ))
            )}
          </div>
        </Card>

        {/* ONGOING PROJECTS */}
        <Card emoji="🎯" title="Ongoing Projects">
          <span className="text-xs text-gray-400 -mt-2">{projectsDone}/{projectsTotal} actions done</span>
          <div className="space-y-5">
            {data.projects.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No active projects</p>
            ) : (
              data.projects.map(project => (
                <div key={project.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-gray-900">{project.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      project.status === 'In Progress' ? 'bg-blue-100 text-blue-600' :
                      project.status === 'Blocked' ? 'bg-red-100 text-red-600' :
                      'bg-gray-100 text-gray-500'
                    }`}>{project.status}</span>
                  </div>
                  {project.todos.length === 0 ? (
                    <p className="text-xs text-gray-400 italic ml-1">No actions set</p>
                  ) : (
                    <div className="space-y-2">
                      {project.todos.map(todo => (
                        <CheckItem key={todo.id} id={todo.id} text={todo.text} checked={todo.checked}
                          onChange={(id, checked) => toggleTodo(id, checked, 'project', project.id)} />
                      ))}
                    </div>
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
              <textarea
                value={braindump}
                onChange={e => setBraindump(e.target.value)}
                placeholder="Drop an idea..."
                style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.8)' }}
                className="w-full rounded-xl px-3 py-2 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all"
                rows={4}
              />
              {braindump.trim() && (
                <button onClick={() => { setProjectName(braindump.trim()); setShowPromote(true); }}
                  className="text-xs bg-orange-500 hover:bg-orange-400 text-white px-4 py-2 rounded-lg font-semibold transition-colors shadow-sm">
                  Move to Projects →
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-400 italic">&ldquo;{braindump}&rdquo;</p>
              <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Project name"
                style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.8)' }}
                className="w-full rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" />
              {nextActions.map((action, i) => (
                <input key={i} value={action}
                  onChange={e => { const a = [...nextActions]; a[i] = e.target.value; setNextActions(a); }}
                  placeholder={`Next action ${i + 1}`}
                  style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.8)' }}
                  className="w-full rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all" />
              ))}
              <div className="flex gap-2 pt-1">
                <button onClick={handlePromote} disabled={promoting || !projectName.trim()}
                  className="text-xs bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white px-4 py-2 rounded-lg font-semibold transition-colors shadow-sm">
                  {promoting ? 'Creating...' : 'Create Project'}
                </button>
                <button onClick={() => { setShowPromote(false); setProjectName(''); setNextActions(['', '', '']); }}
                  className="text-xs text-gray-400 hover:text-gray-600 px-3 py-2 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* PERSONAL TO DO */}
        <Card emoji="👤" title="Personal To Do">
          <div className="space-y-3">
            {data.personalTodos.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Nothing here</p>
            ) : (
              data.personalTodos.map(todo => (
                <CheckItem key={todo.id} id={todo.id} text={todo.text} checked={todo.checked}
                  onChange={(id, checked) => toggleTodo(id, checked, 'personal')} />
              ))
            )}
          </div>
        </Card>

      </div>
    </div>
  );
}
