import { useEffect, useState } from 'react';
import { Activity, Gauge, GraduationCap, Timer } from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { Button } from '../components/ui/button';

export const AnalyticsPage = () => {
  const { analytics, refreshAnalytics } = useAppState();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      await refreshAnalytics().finally(() => setLoading(false));
    };

    void run();
  }, [refreshAnalytics]);

  if (!analytics) {
    return (
      <div className="rounded-2xl border border-white/15 bg-black/30 p-6 text-sm text-slate-300 backdrop-blur-xl">
        {loading ? 'Loading analytics...' : 'No analytics data yet.'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-white/15 bg-black/30 p-4 backdrop-blur-xl sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">Performance Analytics</h2>
            <p className="text-sm text-slate-400">Track mastery, time-on-task, and module consistency.</p>
          </div>
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={async () => {
              setLoading(true);
              await refreshAnalytics().finally(() => setLoading(false));
            }}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-400">
              <GraduationCap size={14} />
              Skill Level
            </div>
            <p className="mt-2 text-2xl font-semibold capitalize text-slate-100">{analytics.currentSkillLevel}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-400">
              <Activity size={14} />
              Quiz Attempts
            </div>
            <p className="mt-2 text-2xl font-semibold text-slate-100">{analytics.totalQuizAttempts}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-400">
              <Gauge size={14} />
              Average Score
            </div>
            <p className="mt-2 text-2xl font-semibold text-slate-100">{analytics.averageQuizScore}%</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-400">
              <Timer size={14} />
              Time on Task
            </div>
            <p className="mt-2 text-2xl font-semibold text-slate-100">
              {Math.round(analytics.totalTimeOnTaskSeconds / 60)} min
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/15 bg-black/30 p-4 backdrop-blur-xl sm:p-5">
        <h3 className="text-base font-semibold text-slate-100">Module Breakdown</h3>
        <div className="mt-3 space-y-2">
          {analytics.moduleBreakdown.length === 0 ? (
            <p className="text-sm text-slate-400">No module progress yet.</p>
          ) : (
            analytics.moduleBreakdown.map((entry) => (
              <div
                key={entry.module}
                className="grid gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200 sm:grid-cols-4"
              >
                <span className="font-medium">{entry.module}</span>
                <span>{entry.completed ? 'Completed' : 'In progress'}</span>
                <span>{Math.round(entry.timeOnTaskSeconds / 60)} min</span>
                <span>Best score: {entry.bestScore ?? 'n/a'}%</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-white/15 bg-black/30 p-4 backdrop-blur-xl sm:p-5">
        <h3 className="text-base font-semibold text-slate-100">Recent Quiz Scores</h3>
        <div className="mt-3 space-y-2">
          {analytics.recentQuizScores.length === 0 ? (
            <p className="text-sm text-slate-400">No completed quizzes yet.</p>
          ) : (
            analytics.recentQuizScores.map((entry) => (
              <div key={`${entry.module}-${entry.completedAt}`} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                <span className="font-medium">{entry.module}</span> | {entry.score}% |{' '}
                {new Date(entry.completedAt).toLocaleString()}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};

