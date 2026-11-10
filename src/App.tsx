import { Suspense, lazy, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AdminHome } from './admin/AdminHome';
import { AviariesAdmin } from './admin/AviariesAdmin';
import { BirdEdit } from './admin/BirdEdit';
import { BirdsAdmin } from './admin/BirdsAdmin';
import { ImportCsv } from './admin/ImportCsv';
import { QrSheet } from './admin/QrSheet';
import { RouteAdmin } from './admin/RouteAdmin';
import { StaffAdmin } from './admin/StaffAdmin';
import { Layout } from './components/Layout';
import { AviaryPage } from './pages/AviaryPage';
import { BirdPage } from './pages/BirdPage';
import { Login } from './pages/Login';
import { Today } from './pages/Today';
import { SectionPage } from './pages/SectionPage';
import { Weigh } from './pages/Weigh';
import { Records } from './pages/Records';
import { WeekChart } from './pages/WeekChart';
import { Clean } from './pages/Clean';
import { Ferrets } from './pages/Ferrets';
import { More } from './pages/More';
import { Round } from './pages/Round';
import { FeedSheet } from './pages/FeedSheet';
import { Checkups } from './pages/Checkups';
import { Session } from './pages/Session';
import { AalHome, R1Page, R2List, R2Page, R3Page, R4Page, R5Page } from './pages/Aal';
import { NewOutingPage, OutingPage, OutingR6, OutingR7, OutingR8, OutingsPage } from './pages/Outings';
import { Health, IssuePage, MedicationPage, NewIssue, NewMedication } from './pages/Health';
import { CareAdmin } from './admin/CareAdmin';
import { DriveAdmin } from './admin/DriveAdmin';
import { StoreProvider, useStore } from './store';
import { configured } from './supabase';

// The map and GPS reader are only loaded when someone opens a flight
const Flights = lazy(() => import('./pages/Flights').then((m) => ({ default: m.Flights })));
const FlightDetail = lazy(() => import('./pages/Flights').then((m) => ({ default: m.FlightDetail })));

export function App() {
  if (!configured)
    return (
      <main className="login">
        <h1>Not set up yet</h1>
        <p>The Supabase address and key are missing. See SETUP.md.</p>
      </main>
    );
  return (
    <BrowserRouter>
      <StoreProvider>
        <Gate />
      </StoreProvider>
    </BrowserRouter>
  );
}

function Gate() {
  const { session, authReady } = useStore();
  if (!authReady) return null;
  if (!session) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Today />} />
        <Route path="weigh" element={<Weigh />} />
        <Route path="weigh/records" element={<Records />} />
        <Route path="weigh/week" element={<WeekChart />} />
        <Route path="feed-sheet" element={<FeedSheet />} />
        <Route path="checkups" element={<Checkups />} />
        <Route path="feed-sheet/:section" element={<FeedSheet />} />
        <Route path="weigh/records/:id" element={<Records />} />
        <Route path="clean" element={<Clean />} />
        <Route path="ferrets" element={<Ferrets />} />
        <Route path="more" element={<More />} />
        <Route path="round" element={<Round />} />
        <Route path="session" element={<Session />} />
        <Route path="health" element={<Health />} />
        <Route path="health/issue/new" element={<NewIssue />} />
        <Route path="health/issue/:id" element={<IssuePage />} />
        <Route path="health/med/new" element={<NewMedication />} />
        <Route path="health/med/:id" element={<MedicationPage />} />
        <Route path="flights" element={<Suspense fallback={<p className="empty">Loading…</p>}><Flights /></Suspense>} />
        <Route path="flights/:id" element={<Suspense fallback={<p className="empty">Loading…</p>}><FlightDetail /></Suspense>} />
        <Route path="a/:slug" element={<AviaryPage />} />
        <Route path="s/:name" element={<SectionPage />} />
        <Route path="bird/:id" element={<BirdPage />} />
        <Route path="aal" element={<AdminOnly><AalHome /></AdminOnly>} />
        <Route path="aal/r1" element={<AdminOnly><R1Page /></AdminOnly>} />
        <Route path="aal/r2" element={<AdminOnly><R2List /></AdminOnly>} />
        <Route path="aal/r2/:id" element={<AdminOnly><R2Page /></AdminOnly>} />
        <Route path="aal/r3" element={<AdminOnly><R3Page /></AdminOnly>} />
        <Route path="aal/r4" element={<R4Page />} />
        <Route path="aal/r5" element={<AdminOnly><R5Page /></AdminOnly>} />
        <Route path="outings" element={<OutingsPage />} />
        <Route path="outings/new" element={<NewOutingPage />} />
        <Route path="outings/:id" element={<OutingPage />} />
        <Route path="outings/:id/r8" element={<OutingR8 />} />
        <Route path="outings/:id/r6" element={<OutingR6 />} />
        <Route path="outings/:id/r7" element={<OutingR7 />} />
        <Route path="admin" element={<AdminOnly><AdminHome /></AdminOnly>} />
        <Route path="admin/birds" element={<AdminOnly><BirdsAdmin /></AdminOnly>} />
        <Route path="admin/birds/:id" element={<AdminOnly><BirdEdit /></AdminOnly>} />
        <Route path="admin/aviaries" element={<AdminOnly><AviariesAdmin /></AdminOnly>} />
        <Route path="admin/import" element={<AdminOnly><ImportCsv /></AdminOnly>} />
        <Route path="admin/route" element={<AdminOnly><RouteAdmin /></AdminOnly>} />
        <Route path="admin/care" element={<AdminOnly><CareAdmin /></AdminOnly>} />
        <Route path="admin/qr" element={<AdminOnly><QrSheet /></AdminOnly>} />
        <Route path="admin/staff" element={<AdminOnly><StaffAdmin /></AdminOnly>} />
        <Route path="admin/drive" element={<AdminOnly><DriveAdmin /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin, me } = useStore();
  const location = useLocation();
  if (!me) return <p className="empty">Loading…</p>;
  if (!isAdmin) return <Navigate to="/" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
