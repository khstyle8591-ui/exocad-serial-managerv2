import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import ResetRequestPage from './pages/ResetRequestPage';
import ResetConfirmPage from './pages/ResetConfirmPage';
import DashboardPage from './pages/DashboardPage';
import SetupPage from './pages/SetupPage';
import RequestsPage from './pages/RequestsPage';
import ProfilePage from './pages/ProfilePage';

function AppRoutes() {
  const { account, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/login"         element={account ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
        <Route path="/signup"        element={account ? <Navigate to="/dashboard" replace /> : <SignupPage />} />
        <Route path="/reset-request" element={<ResetRequestPage />} />
        <Route path="/reset"         element={<ResetConfirmPage />} />

        <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/setup"     element={<ProtectedRoute><SetupPage /></ProtectedRoute>} />
        <Route path="/requests"  element={<ProtectedRoute><RequestsPage /></ProtectedRoute>} />
        <Route path="/profile"   element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />

        <Route path="/" element={<Navigate to={account ? '/dashboard' : '/login'} replace />} />
        <Route path="*" element={<Navigate to={account ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
