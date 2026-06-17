import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// placeholder — pages will be added in Phase 1+
function ComingSoon() {
  return (
    <div className="auth-wrapper">
      <div className="auth-card text-center">
        <div className="auth-logo">
          <span>Exocad Portal</span>
          <p>Customer Portal</p>
        </div>
        <p className="text-muted">준비 중입니다...</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<ComingSoon />} />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
