import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth, RequireRole } from './auth/AuthContext';
import { OfflineProvider } from './offline/OfflineContext';
import { ToastProvider } from './components/Toast';
import AppShell from './components/AppShell';
import Login from './screens/Login';
import Queue from './screens/Queue';
import Appointments from './screens/Appointments';
import Machines from './screens/Machines';
import OT from './screens/OT';
import Inventory from './screens/Inventory';
import Admin from './screens/Admin';
import MRs from './screens/MRs';

/* Route table. AppShell is the layout route: rail/topbar/mobile nav wrap every
   authenticated screen. Add a screen = add a Route here + a NAV_ITEMS entry in nav.js. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/queue" replace />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/queue/:stage" element={<Queue />} />
        <Route path="/appointments" element={<Appointments />} />
        <Route path="/machines" element={<Machines />} />
        <Route path="/ot" element={<OT />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/mrs" element={<MRs />} />
        <Route
          path="/admin"
          element={
            <RequireRole roles={['admin']}>
              <Admin />
            </RequireRole>
          }
        />
        <Route path="*" element={<Navigate to="/queue" replace />} />
      </Route>
    </Routes>
  );
}

/** Providers without the router — tests wrap this in a MemoryRouter. */
export function AppProviders({ children, initialUser }) {
  return (
    <AuthProvider initialUser={initialUser}>
      <OfflineProvider>
        <ToastProvider>{children}</ToastProvider>
      </OfflineProvider>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </BrowserRouter>
  );
}
