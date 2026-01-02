import { useAuth } from '../../context/AuthContext';

export function UnauthorizedPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>

          <p className="text-gray-600 mb-4">
            Your domain <span className="font-semibold text-gray-800">@{user?.domain}</span> is not authorized to access this application.
          </p>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-blue-800">
              To request access, please email:
            </p>
            <a
              href="mailto:kumar@airmdr.com?subject=OKR%20Lite%20Domain%20Access%20Request&body=Hi%2C%0A%0AI%20would%20like%20to%20request%20access%20for%20my%20domain%20to%20use%20OKR%20Lite.%0A%0AMy%20email%3A%20${user?.email}%0AMy%20domain%3A%20${user?.domain}%0A%0AThank%20you!"
              className="text-lg font-medium text-blue-600 hover:text-blue-700 underline"
            >
              kumar@airmdr.com
            </a>
          </div>

          <div className="flex items-center gap-3 mb-6 p-3 bg-gray-50 rounded-lg">
            {user?.picture && (
              <img
                src={user.picture}
                alt={user.name}
                className="w-10 h-10 rounded-full"
              />
            )}
            <div className="text-left">
              <p className="text-sm font-medium text-gray-900">{user?.name}</p>
              <p className="text-xs text-gray-500">{user?.email}</p>
            </div>
          </div>

          <button
            onClick={logout}
            className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
          >
            Sign out and try another account
          </button>
        </div>
      </div>
    </div>
  );
}
