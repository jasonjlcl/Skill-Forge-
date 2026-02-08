import { BarChart3, CheckCircle2, MessageSquare, PenSquare, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { Module, SkillLevel } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '../lib/utils';

interface SidebarProps {
  modules: Module[];
  selectedModule: string;
  onSelectModule: (moduleId: string) => void;
  onQuickQuiz: () => void;
  skillLevel?: SkillLevel;
  language?: string;
  compact?: boolean;
  onDone?: () => void;
}

const statusClasses: Record<Module['status'], string> = {
  not_started: 'bg-slate-400/60',
  in_progress: 'bg-amber-300',
  completed: 'bg-emerald-300',
};

const statusLabel: Record<Module['status'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

export const Sidebar = ({
  modules,
  selectedModule,
  onSelectModule,
  onQuickQuiz,
  skillLevel,
  language,
  compact,
  onDone,
}: SidebarProps) => {
  const [query, setQuery] = useState('');

  const filteredModules = useMemo(() => {
    if (!query.trim()) {
      return modules;
    }

    return modules.filter((module) => module.name.toLowerCase().includes(query.toLowerCase()));
  }, [modules, query]);

  const completedCount = modules.filter((module) => module.status === 'completed').length;
  const averageProgress =
    modules.length > 0
      ? Math.round(modules.reduce((sum, module) => sum + module.progress, 0) / modules.length)
      : 0;

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-white/15 bg-black/30 p-4 text-slate-100 backdrop-blur-xl">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">SkillForge Interface</p>
        <h1 className="text-lg font-semibold leading-tight">Manufacturing Onboarding Copilot</h1>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
        <span className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 capitalize">
          {skillLevel ?? 'beginner'}
        </span>
        <span className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 uppercase">
          {language ?? 'EN'}
        </span>
      </div>

      <nav className="mt-4 grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        <NavLink
          to="/chat"
          onClick={onDone}
          className={({ isActive }) =>
            cn(
              'flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs transition',
              isActive
                ? 'bg-cyan-300/20 text-cyan-100 ring-1 ring-cyan-300/30'
                : 'text-slate-300 hover:bg-white/10 hover:text-slate-100',
            )
          }
        >
          <MessageSquare size={14} />
          Chat
        </NavLink>
        <NavLink
          to="/quiz"
          onClick={onDone}
          className={({ isActive }) =>
            cn(
              'flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs transition',
              isActive
                ? 'bg-cyan-300/20 text-cyan-100 ring-1 ring-cyan-300/30'
                : 'text-slate-300 hover:bg-white/10 hover:text-slate-100',
            )
          }
        >
          <PenSquare size={14} />
          Quiz
        </NavLink>
        <NavLink
          to="/analytics"
          onClick={onDone}
          className={({ isActive }) =>
            cn(
              'flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs transition',
              isActive
                ? 'bg-cyan-300/20 text-cyan-100 ring-1 ring-cyan-300/30'
                : 'text-slate-300 hover:bg-white/10 hover:text-slate-100',
            )
          }
        >
          <BarChart3 size={14} />
          Stats
        </NavLink>
      </nav>

      <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center justify-between text-xs text-slate-300">
          <span>Overall progress</span>
          <span>{averageProgress}%</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-violet-300"
            style={{ width: `${averageProgress}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {completedCount}/{modules.length} modules completed
        </p>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2">
        <Search size={14} className="text-slate-400" />
        <Input
          placeholder="Search modules"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-9 border-none bg-transparent px-0 text-sm focus-visible:ring-0"
        />
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {filteredModules.map((module) => {
          const selected = module.id === selectedModule;
          return (
            <button
              key={module.id}
              type="button"
              onClick={() => {
                onSelectModule(module.id);
                onDone?.();
              }}
              className={cn(
                'w-full rounded-xl border px-3 py-3 text-left transition',
                selected
                  ? 'border-cyan-300/40 bg-cyan-300/10 ring-1 ring-cyan-300/30'
                  : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10',
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-100">{module.name}</p>
                {module.status === 'completed' ? <CheckCircle2 size={14} className="text-emerald-300" /> : null}
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                <span className={cn('h-2 w-2 rounded-full', statusClasses[module.status])} />
                <span>{statusLabel[module.status]}</span>
                <span className="ml-auto">{module.progress}%</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-300/90 to-violet-300/80"
                  style={{ width: `${Math.max(4, module.progress)}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>

      <Button
        className={cn(
          'mt-3 w-full rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 hover:from-cyan-300 hover:to-violet-400',
          compact && 'h-10',
        )}
        title="Start a quick module quiz"
        onClick={() => {
          onQuickQuiz();
          onDone?.();
        }}
      >
        <PenSquare size={15} className="mr-1.5" />
        Quick Quiz
      </Button>
    </aside>
  );
};

