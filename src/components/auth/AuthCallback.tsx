import { useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

export function AuthCallback() {
  const { checkAuth } = useAuth();

  useEffect(() => {
    // Re-check auth status after OAuth callback, then go back to the page
    // sign-in started from (saved by login()), or home.
    checkAuth().then(() => {
      let target = '/';
      try {
        const saved = sessionStorage.getItem('okr-return-to');
        sessionStorage.removeItem('okr-return-to');
        // Same-origin paths only.
        if (saved && saved.startsWith('/') && !saved.startsWith('//')) target = saved;
      } catch { /* ignore */ }
      window.history.replaceState({}, '', target);
      window.location.reload();
    });
  }, [checkAuth]);

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Completing sign in...</p>
      </div>
    </div>
  );
}
