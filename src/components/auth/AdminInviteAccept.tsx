import { useState, useEffect } from 'react';
import { Button } from '../common/Button';

const API_URL = import.meta.env.VITE_API_URL || '';

export function AdminInviteAccept() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'already_accepted'>('loading');
  const [organizationName, setOrganizationName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const acceptInvite = async () => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');
      const orgId = params.get('org');

      if (!token || !orgId) {
        setStatus('error');
        setErrorMessage('Invalid invite link. Missing token or organization ID.');
        return;
      }

      try {
        const response = await fetch(`${API_URL}/api/invite/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, orgId }),
        });

        const data = await response.json();

        if (!response.ok) {
          setStatus('error');
          setErrorMessage(data.error || 'Failed to accept invite');
          return;
        }

        setOrganizationName(data.organization?.name || 'Unknown Organization');

        if (data.alreadyAccepted) {
          setStatus('already_accepted');
        } else {
          setStatus('success');
        }
      } catch (err) {
        setStatus('error');
        setErrorMessage('Failed to connect to server. Please try again later.');
        console.error(err);
      }
    };

    acceptInvite();
  }, []);

  const goToLogin = () => {
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        {status === 'loading' && (
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Accepting invite...</p>
          </div>
        )}

        {status === 'success' && (
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="mt-4 text-xl font-semibold text-gray-900">Invite Accepted!</h2>
            <p className="mt-2 text-gray-600">
              You are now an administrator for <strong>{organizationName}</strong>.
            </p>
            <p className="mt-4 text-sm text-gray-500">
              Sign in with your Google account to access the admin dashboard.
            </p>
            <Button className="mt-6 w-full" onClick={goToLogin}>
              Go to Login
            </Button>
          </div>
        )}

        {status === 'already_accepted' && (
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100">
              <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="mt-4 text-xl font-semibold text-gray-900">Already Accepted</h2>
            <p className="mt-2 text-gray-600">
              This invite for <strong>{organizationName}</strong> was already accepted.
            </p>
            <p className="mt-4 text-sm text-gray-500">
              You can sign in to access the admin dashboard.
            </p>
            <Button className="mt-6 w-full" onClick={goToLogin}>
              Go to Login
            </Button>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="mt-4 text-xl font-semibold text-gray-900">Invalid Invite</h2>
            <p className="mt-2 text-gray-600">{errorMessage}</p>
            <p className="mt-4 text-sm text-gray-500">
              Please contact your administrator for a valid invite link.
            </p>
            <Button className="mt-6 w-full" variant="secondary" onClick={goToLogin}>
              Go to Home
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
