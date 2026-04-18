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

interface DashboardData {
  dateStr: string;
  weather: string;
  dailyTasks: Todo[];
  projects: Project[];
  personalTodos: Todo[];
}

function Card({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-base">{emoji}</span>
        <span className="text-xs font-bold tracking-widest uppercase text-orange-400">{title}</span>
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
        className="mt-0.5 w-4 h-4 rounded accent-orange-400 bg-gray-800 border-gray-600 shrink-0"
      />
      <span className={`text-sm leading-snug transition-colors ${checked ? 'line-through text-gray-600' : 'text-gray-200'}`}>
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

  useEffect(() => {
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
    <div className="min-h-screen bg-black flex items-center justify-center">
      <p className="text-gray-600 text-xs tracking-widest uppercase animate-pulse">Loading...</p>
    </div>
  );

  if (!data) return null;

  const dailyDone = data.dailyTasks.filter(t => t.checked).length;
  const projectsDone = data.projects.flatMap(p => p.todos).filter(t => t.checked).length;
  const projectsTotal = data.projects.flatMap(p => p.todos).length;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="max-w-5xl mx-auto px-5 pt-8 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">G&apos;DAY TIGER OS</h1>
          <p className="text-xs text-gray-500 mt-0.5">{data.dateStr} &nbsp;·&nbsp; {data.weather}</p>
        </div>
        <span className="text-2xl">🐯</span>
      </div>

      {/* Grid */}
      <div className="max-w-5xl mx-auto px-5 pb-10 grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* DAILY TO DO */}
        <Card emoji="⚡" title="Daily To Do">
          <div className="flex items-center justify-between -mt-2">
            <span className="text-xs text-gray-600">
              {dailyDone}/{data.dailyTasks.length} done
            </span>
          </div>
          <div className="space-y-3">
            {data.dailyTasks.length === 0 ? (
              <p className="text-sm text-gray-600 italic">No tasks today 🎉</p>
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

        {/* ONGOING PROJECTS */}
        <Card emoji="🎯" title="Ongoing Projects">
          <div className="flex items-center justify-between -mt-2">
            <span className="text-xs text-gray-600">
              {projectsDone}/{projectsTotal} actions done
            </span>
          </div>
          <div className="space-y-5">
            {data.projects.length === 0 ? (
              <p className="text-sm text-gray-600 italic">No active projects</p>
            ) : (
              data.projects.map(project => (
                <div key={project.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-white">{project.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      project.status === 'In Progress' ? 'bg-blue-950 text-blue-400' :
                      project.status === 'Blocked' ? 'bg-red-950 text-red-400' :
                      'bg-gray-800 text-gray-500'
                    }`}>
                      {project.status}
                    </span>
                  </div>
                  {project.todos.length === 0 ? (
                    <p className="text-xs text-gray-600 italic ml-1">No actions set</p>
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
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-orange-500 transition-colors"
                rows={4}
              />
              {braindump.trim() && (
                <button
                  onClick={() => { setProjectName(braindump.trim()); setShowPromote(true); }}
                  className="text-xs bg-orange-500 hover:bg-orange-400 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                >
                  Move to Projects →
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 italic">&ldquo;{braindump}&rdquo;</p>
              <input
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="Project name"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
              />
              {nextActions.map((action, i) => (
                <input
                  key={i}
                  value={action}
                  onChange={e => { const a = [...nextActions]; a[i] = e.target.value; setNextActions(a); }}
                  placeholder={`Next action ${i + 1}`}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
                />
              ))}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handlePromote}
                  disabled={promoting || !projectName.trim()}
                  className="text-xs bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                >
                  {promoting ? 'Creating...' : 'Create Project'}
                </button>
                <button
                  onClick={() => { setShowPromote(false); setProjectName(''); setNextActions(['', '', '']); }}
                  className="text-xs text-gray-500 hover:text-gray-300 px-3 py-2 transition-colors"
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
              <p className="text-sm text-gray-600 italic">Nothing here</p>
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
