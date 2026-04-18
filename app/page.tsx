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
      <p className="text-gray-500 text-sm tracking-widest">LOADING...</p>
    </div>
  );

  if (!data) return null;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-xl mx-auto px-5 py-10 space-y-10">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">G&apos;DAY TIGER OS</h1>
            <p className="text-xs text-gray-500 mt-0.5">{data.dateStr}</p>
          </div>
          <span className="text-2xl">🐯</span>
        </div>

        {/* TODAY */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs font-semibold text-orange-400 tracking-widest uppercase">⚡ Today</span>
          </div>
          <p className="text-sm text-gray-400 mb-4">{data.weather}</p>
          <div className="space-y-3">
            {data.dailyTasks.length === 0 ? (
              <p className="text-sm text-gray-600 italic">No tasks today 🎉</p>
            ) : (
              data.dailyTasks.map(task => (
                <label key={task.id} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={task.checked}
                    onChange={e => toggleTodo(task.id, e.target.checked, 'daily')}
                    className="mt-0.5 w-4 h-4 rounded accent-orange-400 bg-gray-800 border-gray-600 shrink-0"
                  />
                  <span className={`text-sm leading-snug ${task.checked ? 'line-through text-gray-600' : 'text-white font-medium'}`}>
                    {task.text}
                  </span>
                </label>
              ))
            )}
          </div>
        </section>

        <div className="border-t border-gray-800" />

        {/* ONGOING PROJECTS */}
        <section>
          <div className="mb-4">
            <span className="text-xs font-semibold text-orange-400 tracking-widest uppercase">🎯 Ongoing Projects</span>
          </div>
          {data.projects.length === 0 ? (
            <p className="text-sm text-gray-600 italic">No active projects</p>
          ) : (
            <div className="space-y-6">
              {data.projects.map(project => (
                <div key={project.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold">{project.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      project.status === 'In Progress' ? 'bg-blue-950 text-blue-400' :
                      project.status === 'Blocked' ? 'bg-red-950 text-red-400' :
                      project.status === 'Not Started' ? 'bg-gray-800 text-gray-400' :
                      'bg-gray-800 text-gray-400'
                    }`}>
                      {project.status}
                    </span>
                  </div>
                  {project.todos.length === 0 ? (
                    <p className="text-xs text-gray-600 italic ml-1">No actions set</p>
                  ) : (
                    <div className="space-y-2">
                      {project.todos.map(todo => (
                        <label key={todo.id} className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={todo.checked}
                            onChange={e => toggleTodo(todo.id, e.target.checked, 'project', project.id)}
                            className="mt-0.5 w-4 h-4 rounded accent-orange-400 bg-gray-800 border-gray-600 shrink-0"
                          />
                          <span className={`text-sm leading-snug ${todo.checked ? 'line-through text-gray-600' : 'text-gray-300'}`}>
                            {todo.text}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="border-t border-gray-800" />

        {/* BRAIN DUMP */}
        <section>
          <div className="mb-4">
            <span className="text-xs font-semibold text-orange-400 tracking-widest uppercase">🧠 Brain Dump</span>
          </div>
          {!showPromote ? (
            <div className="space-y-3">
              <textarea
                value={braindump}
                onChange={e => setBraindump(e.target.value)}
                placeholder="Drop an idea..."
                className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-orange-500 transition-colors"
                rows={3}
              />
              {braindump.trim() && (
                <button
                  onClick={() => { setProjectName(braindump.trim()); setShowPromote(true); }}
                  className="text-xs bg-orange-500 hover:bg-orange-400 text-white px-3 py-1.5 rounded-md font-semibold transition-colors"
                >
                  Move to Projects →
                </button>
              )}
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3">
              <p className="text-xs text-gray-500 italic">&ldquo;{braindump}&rdquo;</p>
              <input
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="Project name"
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
              />
              {nextActions.map((action, i) => (
                <input
                  key={i}
                  value={action}
                  onChange={e => { const a = [...nextActions]; a[i] = e.target.value; setNextActions(a); }}
                  placeholder={`Next action ${i + 1}`}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
                />
              ))}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handlePromote}
                  disabled={promoting || !projectName.trim()}
                  className="text-xs bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white px-3 py-1.5 rounded-md font-semibold transition-colors"
                >
                  {promoting ? 'Creating...' : 'Create Project'}
                </button>
                <button
                  onClick={() => { setShowPromote(false); setProjectName(''); setNextActions(['', '', '']); }}
                  className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

        <div className="border-t border-gray-800" />

        {/* PERSONAL TO DO */}
        <section>
          <div className="mb-4">
            <span className="text-xs font-semibold text-orange-400 tracking-widest uppercase">👤 Personal To Do</span>
          </div>
          <div className="space-y-3">
            {data.personalTodos.length === 0 ? (
              <p className="text-sm text-gray-600 italic">Nothing here</p>
            ) : (
              data.personalTodos.map(todo => (
                <label key={todo.id} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={todo.checked}
                    onChange={e => toggleTodo(todo.id, e.target.checked, 'personal')}
                    className="mt-0.5 w-4 h-4 rounded accent-orange-400 bg-gray-800 border-gray-600 shrink-0"
                  />
                  <span className={`text-sm leading-snug ${todo.checked ? 'line-through text-gray-600' : 'text-gray-300'}`}>
                    {todo.text}
                  </span>
                </label>
              ))
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
