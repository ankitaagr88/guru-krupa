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
import PrescriptionsToday from './screens/Prescription';
import Patient from './screens/Patient';
import Today from './screens/Today';
import DayBook from './screens/DayBook';
import Register from './screens/Register';

/* Route table. AppShell is the layout route: rail/topbar/mobile nav wrap every
   authenticated screen. Add a screen = add a Route here + a NAV_ITEMS entry in nav.js. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* New patient form: public (QR poster at the desk); staff who are signed in use it too. */}
      <Route path="/register" element={<Register />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        {/* The app opens on the Queue (the desk's main screen), though Appointments is first in the menu. */}
        <Route index element={<Navigate to="/queue" replace />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/queue/:stage" element={<Queue />} />
        <Route path="/patients/:id" element={<Patient />} />
        <Route path="/appointments" element={<Appointments />} />
        <Route path="/machines" element={<Machines />} />
        <Route path="/ot" element={<OT />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/mrs" element={<MRs />} />
        <Route
          path="/prescriptions"
          element={
            <RequireRole roles={['doctor', 'admin']}>
              <PrescriptionsToday />
            </RequireRole>
          }
        />
        <Route
          path="/today"
          element={
            <RequireRole roles={['admin', 'doctor', 'reception']}>
              <Today />
            </RequireRole>
          }
        />
        <Route
          path="/daybook"
          element={
            <RequireRole roles={['admin', 'doctor', 'reception']}>
              <DayBook />
            </RequireRole>
          }
        />
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

/* Opt in to React Router v7 behaviour now (silences the console warnings): state updates in
   startTransition, and relative links inside splat routes resolve like v7. We have no splat routes
   with relative links, so nothing changes for us. */
export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

export default function App() {
  return (
    <BrowserRouter future={ROUTER_FUTURE}>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </BrowserRouter>
  );
}
