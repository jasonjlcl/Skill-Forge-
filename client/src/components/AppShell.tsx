import { LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { Module } from '../types';
import { AnimatedBackground } from './AnimatedBackground';
import { Sidebar } from './Sidebar';
import { Button } from './ui/button';

interface AppShellProps {
  modules: Module[];
  selectedModule: string;
  onModuleChange: (moduleId: string) => void;
  children: ReactNode;
}

export const AppShell = ({ modules, selectedModule, onModuleChange, children }: AppShellProps) => {
  const { user, logout } = useAuth();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [theme, setTheme] = useLocalStorage<'dark' | 'light'>('ui_theme', 'dark');
  const navigate = useNavigate();

  const openQuiz = () => {
    navigate('/quiz');
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="relative min-h-screen text-slate-100">
      <AnimatedBackground />

      <div className="relative z-10 h-screen p-2 sm:p-3">
        <div className="mx-auto grid h-full max-w-[1800px] gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="hidden min-h-0 lg:block">
            <Sidebar
              modules={modules}
              selectedModule={selectedModule}
              onSelectModule={onModuleChange}
              onQuickQuiz={openQuiz}
              skillLevel={user?.skillLevel}
              language={user?.language}
            />
          </div>

          <div className="flex min-h-0 flex-col">
            <header className="mb-3 flex items-center justify-between rounded-2xl border border-white/15 bg-black/25 px-3 py-2 backdrop-blur-xl lg:hidden">
              <Button
                variant="ghost"
                size="icon"
                title="Open modules"
                className="h-9 w-9 rounded-xl border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10"
                onClick={() => setMobileSidebarOpen(true)}
              >
                <Menu size={17} />
              </Button>

              <div className="text-center">
                <p className="text-sm font-semibold">{selectedModule}</p>
                <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200">SkillForge</p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                  className="h-9 w-9 rounded-xl border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10"
                  onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
                >
                  {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  title="Logout"
                  className="h-9 w-9 rounded-xl border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10"
                  onClick={async () => {
                    await logout();
                    navigate('/auth');
                  }}
                >
                  <LogOut size={16} />
                </Button>
              </div>
            </header>

            <div className="mb-3 hidden items-center justify-end gap-3 rounded-2xl border border-white/15 bg-black/25 px-4 py-2 backdrop-blur-xl lg:flex">
              <Button
                variant="ghost"
                size="icon"
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                className="h-9 w-9 rounded-xl border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10"
                onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </Button>
              <div className="text-right">
                <p className="text-sm text-slate-100">{user?.email}</p>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                  {user?.skillLevel ?? 'beginner'} / {user?.language ?? 'en'}
                </p>
              </div>
              <Button
                variant="ghost"
                className="rounded-xl border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10"
                onClick={async () => {
                  await logout();
                  navigate('/auth');
                }}
              >
                <LogOut size={15} className="mr-1.5" />
                Logout
              </Button>
            </div>

            <main className="min-h-0 flex-1">{children}</main>
          </div>
        </div>
      </div>

      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close module drawer"
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[min(84vw,360px)] p-2">
            <div className="relative h-full">
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-3 top-3 z-10 h-8 w-8 rounded-full border border-white/15 bg-white/10 text-slate-100"
                onClick={() => setMobileSidebarOpen(false)}
              >
                <X size={15} />
              </Button>
              <Sidebar
                modules={modules}
                selectedModule={selectedModule}
                onSelectModule={onModuleChange}
                onQuickQuiz={openQuiz}
                skillLevel={user?.skillLevel}
                language={user?.language}
                compact
                onDone={() => setMobileSidebarOpen(false)}
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none fixed bottom-3 right-3 z-40 rounded-lg border border-white/15 bg-black/35 px-2.5 py-1 text-[11px] text-slate-300 backdrop-blur">
        Developed by Jason Lim
      </div>
    </div>
  );
};

