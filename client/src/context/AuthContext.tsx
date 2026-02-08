import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { login, logout, me, register } from '../lib/api';
import type { SkillLevel, UserProfile } from '../types';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
  login: (payload: { email: string; password: string }) => Promise<void>;
  register: (payload: {
    email: string;
    password: string;
    language: string;
    skillLevel: SkillLevel;
  }) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const response = await me();
        setUser(response.user);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    void bootstrap();
  }, []);

  const loginUser = useCallback(async (payload: { email: string; password: string }) => {
    setError(null);
    const response = await login(payload).catch((err: Error) => {
      setError(err.message);
      throw err;
    });

    setUser(response.user);
  }, []);

  const registerUser = useCallback(
    async (payload: {
      email: string;
      password: string;
      language: string;
      skillLevel: SkillLevel;
    }) => {
      setError(null);
      const response = await register(payload).catch((err: Error) => {
        setError(err.message);
        throw err;
      });
      setUser(response.user);
    },
    [],
  );

  const logoutUser = useCallback(async () => {
    await logout();
    setUser(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      login: loginUser,
      register: registerUser,
      logout: logoutUser,
      clearError,
    }),
    [user, loading, error, loginUser, registerUser, logoutUser, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
};

