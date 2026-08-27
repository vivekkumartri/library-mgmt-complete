import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppShell from './components/AppShell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SeatMap from './pages/SeatMap';
import StudentsList from './pages/StudentsList';
import AddStudent from './pages/AddStudent';
import StudentProfile from './pages/StudentProfile';
import Billing from './pages/Billing';
import Attendance from './pages/Attendance';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Admins from './pages/Admins';
import Notices from './pages/Notices';
import { StudentHome, StudentMySeat, StudentFees, StudentProfileSelf, StudentLibraryInfo } from './pages/StudentPortal';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell>{children}</AppShell>;
}

export default function App() {
  const { user } = useAuth();
  const isAdmin = user?.type === 'admin';

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />

      {isAdmin ? (
        <>
          <Route path="/" element={<Protected><Dashboard /></Protected>} />
          <Route path="/seats" element={<Protected><SeatMap /></Protected>} />
          <Route path="/students" element={<Protected><StudentsList statusFilter="active" /></Protected>} />
          <Route path="/students/new" element={<Protected><AddStudent /></Protected>} />
          <Route path="/students/past" element={<Protected><StudentsList statusFilter="past" /></Protected>} />
          <Route path="/students/:id" element={<Protected><StudentProfile /></Protected>} />
          <Route path="/billing" element={<Protected><Billing /></Protected>} />
          <Route path="/attendance" element={<Protected><Attendance /></Protected>} />
          <Route path="/reports" element={<Protected><Reports /></Protected>} />
          <Route path="/notices" element={<Protected><Notices /></Protected>} />
          <Route path="/admins" element={<Protected><Admins /></Protected>} />
          <Route path="/settings" element={<Protected><Settings /></Protected>} />
        </>
      ) : (
        <>
          <Route path="/" element={<Protected><StudentHome /></Protected>} />
          <Route path="/my-seat" element={<Protected><StudentMySeat /></Protected>} />
          <Route path="/fees" element={<Protected><StudentFees /></Protected>} />
          <Route path="/profile" element={<Protected><StudentProfileSelf /></Protected>} />
          <Route path="/library" element={<Protected><StudentLibraryInfo /></Protected>} />
        </>
      )}

      <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
    </Routes>
  );
}
