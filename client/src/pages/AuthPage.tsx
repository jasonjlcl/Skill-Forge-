import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { SkillLevel } from '../types';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { AnimatedBackground } from '../components/AnimatedBackground';

export const AuthPage = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState('en');
  const [skillLevel, setSkillLevel] = useState<SkillLevel>('beginner');
  const [submitting, setSubmitting] = useState(false);
  const { login, register, error, clearError, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate('/chat');
    }
  }, [user, navigate]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    clearError();

    try {
      if (mode === 'login') {
        await login({ email, password });
      } else {
        await register({ email, password, language, skillLevel });
      }
      navigate('/chat');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen text-slate-100">
      <AnimatedBackground />

      <div className="relative z-10 grid min-h-screen place-items-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-white/15 bg-black/35 p-6 backdrop-blur-xl">
          <div className="mb-5 space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">SkillForge</p>
            <h1 className="text-2xl font-semibold leading-tight">
              {mode === 'login' ? 'Welcome back, operator' : 'Create your training profile'}
            </h1>
            <p className="text-sm text-slate-300">
              Secure access to contextual onboarding, explainable guidance, and adaptive quizzes.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-400">Email</label>
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-400">Password</label>
              <Input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {mode === 'register' ? (
              <>
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-400">Language</label>
                  <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    className="h-10 w-full rounded-xl border border-white/15 bg-black/40 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-400/30"
                  >
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                    <option value="pt">Portuguese</option>
                    <option value="hi">Hindi</option>
                    <option value="zh">Chinese</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-400">Skill level</label>
                  <select
                    value={skillLevel}
                    onChange={(event) => setSkillLevel(event.target.value as SkillLevel)}
                    className="h-10 w-full rounded-xl border border-white/15 bg-black/40 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-400/30"
                  >
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </div>
              </>
            ) : null}

            {error ? <p className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm">{error}</p> : null}

            <Button
              type="submit"
              className="w-full rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 hover:from-cyan-300 hover:to-violet-400"
              disabled={submitting}
            >
              <Sparkles size={15} className="mr-1.5" />
              {submitting ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </Button>

            <button
              type="button"
              className="w-full text-sm text-cyan-100/90 underline underline-offset-4"
              onClick={() => {
                clearError();
                setMode((previous) => (previous === 'login' ? 'register' : 'login'));
              }}
            >
              {mode === 'login'
                ? 'Need an account? Register here'
                : 'Already registered? Sign in instead'}
            </button>
          </form>
        </div>
      </div>

      <div className="pointer-events-none fixed bottom-3 right-3 z-30 rounded-lg border border-white/15 bg-black/35 px-2.5 py-1 text-[11px] text-slate-300 backdrop-blur">
        Developed by Jason Lim
      </div>
    </div>
  );
};

