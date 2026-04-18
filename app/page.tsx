'use client';

import { useEffect, useState } from 'react';

interface Todo {
  id: string;
  text: string;
  checked: boolean;
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
  start: string;
  end: string;
  area: string;
  comment: string;
}

interface DashboardData {
  dateStr: string;
  weather: string;
  dailyTasks: Todo[];
  projects: Project[];
  personalTodos: Todo[];
}

function Card({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.45)',
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      border: '1px solid rgba(255, 255, 255, 0.7)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.8)',
    }} className="rounded-3xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-base">{emoji}</span>
        <span className="text-xs font-bold tracking-widest uppercase text-orange-500" style={{ fontFamily: '"stolzl", sans-serif', fontWeight: 700 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function CheckItem({
  id, text, checked, onChange
}: {
  id: string; text: string; checked: boolean; onChange: (id: string, checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(id, e.target.checked)}
        className="mt-0.5 w-4 h-4 rounded accent-orange-500 shrink-0"
      />
      <span className={`text-sm leading-snug transition-colors ${checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
        {text}
      </span>
    </label>
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

  useEffect(() => {
    fetch('/api/roster')
      .then(r => r.json())
      .then(d => setShifts(d.shifts || []));

    fetch('/api/dashboard')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); });
  }, []);

  const toggleTodo = async (
    blockId: string,
    checked: boolean,
    section: 'daily' | 'project' | 'personal',
    projectId?: string
  ) => {
    if (section === 'daily') {
      setData(prev => prev ? {
        ...prev,
        dailyTasks: prev.dailyTasks.map(t => t.id === blockId ? { ...t, checked } : t),
      } : prev);
    } else if (section === 'project' && projectId) {
      setData(prev => prev ? {
        ...prev,
        projects: prev.projects.map(p => p.id === projectId ? {
          ...p,
          todos: p.todos.map(t => t.id === blockId ? { ...t, checked } : t),
        } : p),
      } : prev);
    } else if (section === 'personal') {
      setData(prev => prev ? {
        ...prev,
        personalTodos: prev.personalTodos.map(t => t.id === blockId ? { ...t, checked } : t),
      } : prev);
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
    const fresh = await fetch('/api/dashboard').then(r => r.json());
    setData(fresh);
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

  const dailyDone = data.dailyTasks.filter(t => t.checked).length;
  const projectsDone = data.projects.flatMap(p => p.todos).filter(t => t.checked).length;
  const projectsTotal = data.projects.flatMap(p => p.todos).length;

  return (
    <div className="min-h-screen text-gray-900" style={{
      background: 'linear-gradient(135deg, #e8eeff 0%, #fff8f0 40%, #f0fdf4 100%)',
    }}>
      {/* Decorative blobs */}
      <div style={{
        position: 'fixed', top: '-10%', right: '-5%', width: '400px', height: '400px',
        background: 'radial-gradient(circle, rgba(251,146,60,0.18) 0%, transparent 70%)',
        borderRadius: '50%', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'fixed', bottom: '-10%', left: '-5%', width: '500px', height: '500px',
        background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
        borderRadius: '50%', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'fixed', top: '40%', left: '30%', width: '300px', height: '300px',
        background: 'radial-gradient(circle, rgba(34,197,94,0.08) 0%, transparent 70%)',
        borderRadius: '50%', pointerEvents: 'none',
      }} />

      {/* Header */}
      <div className="max-w-5xl mx-auto px-5 pt-8 pb-4 flex items-center justify-between relative">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-gray-900" style={{ fontFamily: '"bodoni-pt-variable", sans-serif', fontVariationSettings: "'opsz' 18, 'wght' 700" }}>
            G&apos;DAY TIGER <span style={{ color: '#fbcdad' }}>OS</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest" style={{ fontFamily: '"stolzl", sans-serif' }}>{data.dateStr} &nbsp;·&nbsp; {data.weather}</p>
        </div>
        <img src="/logo.png" alt="G'Day Tiger" className="logo-spin h-14 w-14 object-contain" />
      </div>

      {/* Grid */}
      <div className="max-w-5xl mx-auto px-5 pb-10 grid grid-cols-1 md:grid-cols-2 gap-4 relative">

        {/* DAILY TO DO */}
        <Card emoji="⚡" title="Daily To Do">
          <span className="text-xs text-gray-400 -mt-2">{dailyDone}/{data.dailyTasks.length} done</span>
          <div className="space-y-3">
            {data.dailyTasks.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No tasks today 🎉</p>
            ) : (
              data.dailyTasks.map(task => (
                <CheckItem
                  key={task.id}
                  id={task.id}
                  text={task.text}
                  checked={task.checked}
                  onChange={(id, checked) => toggleTodo(id, checked, 'daily')}
                />
              ))
            )}
          </div>
        </Card>

        {/* ROSTER */}
        <Card emoji="📅" title="Roster">
          <div className="space-y-2">
            {shifts.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No shifts found</p>
            ) : (
              shifts.map(shift => {
                const isToday = shift.date === new Date().toISOString().split('T')[0];
                return (
                  <div key={shift.date} className={`flex items-center justify-between py-2 px-3 rounded-xl ${isToday ? 'bg-orange-50 border border-orange-200' : 'bg-white/30'}`}>
                    <div>
                      <span className={`text-sm font-semibold ${isToday ? 'text-orange-600' : 'text-gray-800'}`}>
                        {shift.label}
                        {isToday && <span className="ml-2 text-xs font-medium text-orange-400">TODAY</span>}
                      </span>
                      {shift.area && <p className="text-xs text-gray-400 mt-0.5">{shift.area}</p>}
                      {shift.comment && <p className="text-xs text-gray-400 mt-0.5">{shift.comment}</p>}
                    </div>
                    <span className={`text-sm font-medium ${isToday ? 'text-orange-500' : 'text-gray-500'}`}>
                      {shift.start} – {shift.end}
                    </span>
                  </div>
                );
              })
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
                    }`}>
                      {project.status}
                    </span>
                  </div>
                  {project.todos.length === 0 ? (
                    <p className="text-xs text-gray-400 italic ml-1">No actions set</p>
                  ) : (
                    <div className="space-y-2">
                      {project.todos.map(todo => (
                        <CheckItem
                          key={todo.id}
                          id={todo.id}
                          text={todo.text}
                          checked={todo.checked}
                          onChange={(id, checked) => toggleTodo(id, checked, 'project', project.id)}
                        />
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
                <button
                  onClick={() => { setProjectName(braindump.trim()); setShowPromote(true); }}
                  className="text-xs bg-orange-500 hover:bg-orange-400 text-white px-4 py-2 rounded-lg font-semibold transition-colors shadow-sm"
                >
                  Move to Projects →
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-400 italic">&ldquo;{braindump}&rdquo;</p>
              <input
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="Project name"
                style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.8)' }}
                className="w-full rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all"
              />
              {nextActions.map((action, i) => (
                <input
                  key={i}
                  value={action}
                  onChange={e => { const a = [...nextActions]; a[i] = e.target.value; setNextActions(a); }}
                  placeholder={`Next action ${i + 1}`}
                  style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.8)' }}
                  className="w-full rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all"
                />
              ))}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handlePromote}
                  disabled={promoting || !projectName.trim()}
                  className="text-xs bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white px-4 py-2 rounded-lg font-semibold transition-colors shadow-sm"
                >
                  {promoting ? 'Creating...' : 'Create Project'}
                </button>
                <button
                  onClick={() => { setShowPromote(false); setProjectName(''); setNextActions(['', '', '']); }}
                  className="text-xs text-gray-400 hover:text-gray-600 px-3 py-2 transition-colors"
                >
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
                <CheckItem
                  key={todo.id}
                  id={todo.id}
                  text={todo.text}
                  checked={todo.checked}
                  onChange={(id, checked) => toggleTodo(id, checked, 'personal')}
                />
              ))
            )}
          </div>
        </Card>

      </div>
    </div>
  );
}
