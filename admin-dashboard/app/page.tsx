'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../src/services/api';

function isAdminOrManager(role?: string | null) {
  return role === 'admin' || role === 'manager';
}

export default function LoginPage() {
  const router = useRouter();
  const [emailOrMobile, setEmailOrMobile] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    try {
      setLoading(true);
      const res = await api.post('/auth/login', { emailOrMobile, password });
      const user = res.data.user;

      if (!isAdminOrManager(user?.role)) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setError('Access denied. Web admin is only for admin and manager accounts. Distributor users must use the mobile app.');
        return;
      }

      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(user));
      router.push('/dashboard');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Login failed. Check credentials.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="auth-brand">
          <span className="app-brand-mark">MDP</span>
          <div>
            <strong>Flyer Tracker</strong>
            <span>Admin console</span>
          </div>
        </div>
        <h1>Sign in</h1>
        <p className="auth-help">Only admin and manager accounts can access the web console. Distributors use the mobile app.</p>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <form onSubmit={login} className="auth-form">
          <label className="form-field">
            Email, User ID, or phone
            <input
              placeholder="e.g. vishal or you@example.com"
              value={emailOrMobile}
              onChange={e => setEmailOrMobile(e.target.value)}
              disabled={loading}
              autoComplete="username"
            />
          </label>
          <label className="form-field">
            Password
            <input
              placeholder="••••••••"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
            />
          </label>
          <button disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}
