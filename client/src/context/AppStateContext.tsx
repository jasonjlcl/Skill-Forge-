import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { getAnalytics, getModules } from '../lib/api';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { AnalyticsSnapshot, Module } from '../types';

interface AppStateValue {
  selectedModule: string;
  modules: Module[];
  setSelectedModule: (moduleId: string) => void;
  analytics: AnalyticsSnapshot | null;
  refreshAnalytics: () => Promise<void>;
}

const AppStateContext = createContext<AppStateValue | null>(null);

const mergeModules = (catalog: Module[], analytics: AnalyticsSnapshot | null): Module[] => {
  const map = new Map<string, Module>(catalog.map((module) => [module.id, module]));

  for (const entry of analytics?.moduleBreakdown ?? []) {
    const progress = entry.completed
      ? 100
      : entry.bestScore !== null
        ? Math.max(20, Math.min(92, entry.bestScore))
        : entry.timeOnTaskSeconds > 0
          ? Math.max(8, Math.min(65, Math.round(entry.timeOnTaskSeconds / 12)))
          : 0;

    map.set(entry.module, {
      id: entry.module,
      name: entry.module,
      status: entry.completed ? 'completed' : progress > 0 ? 'in_progress' : 'not_started',
      progress,
      completedAt: entry.completed ? new Date().toISOString() : null,
    });
  }

  return [...map.values()];
};

export const AppStateProvider = ({ children }: PropsWithChildren) => {
  const [selectedModule, setSelectedModule] = useLocalStorage<string>('selected_module', 'Safety Basics');
  const [catalog, setCatalog] = useState<Module[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null);

  const refreshAnalytics = useCallback(async () => {
    const data = await getAnalytics();
    setAnalytics(data);
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      const initialModules = await getModules();
      setCatalog(initialModules);

      try {
        await refreshAnalytics();
      } catch {
        // analytics can fail independently without blocking the UI
      }
    };

    void bootstrap();
  }, [refreshAnalytics]);

  const modules = useMemo(() => mergeModules(catalog, analytics), [catalog, analytics]);

  useEffect(() => {
    if (modules.length === 0) {
      return;
    }

    if (!modules.some((module) => module.id === selectedModule)) {
      setSelectedModule(modules[0].id);
    }
  }, [modules, selectedModule, setSelectedModule]);

  const value = useMemo<AppStateValue>(
    () => ({
      selectedModule,
      modules,
      setSelectedModule,
      analytics,
      refreshAnalytics,
    }),
    [selectedModule, modules, setSelectedModule, analytics, refreshAnalytics],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
};

export const useAppState = () => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used inside AppStateProvider');
  }
  return context;
};

