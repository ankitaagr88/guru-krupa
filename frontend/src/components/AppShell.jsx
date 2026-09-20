import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth, ROLE_LABELS } from '../auth/AuthContext';
import { useDeviceMode } from '../hooks/useDeviceMode';
import { admin, visits, onDataChange, USE_MOCKS } from '../api';
import { STAGES as DEFAULT_STAGES } from '../mocks/data';
import {
  NAV_ITEMS,
  BOTTOM_NAV_KEYS,
  navItemsForRole,
  activeNavKey,
  HOSPITAL_NAME,
  HOSPITAL_SHORT,
  HOSPITAL_WORDMARK,
  HOSPITAL_SUBTITLE,
  DOCTOR_NAME,
} from '../nav';
import { IconMenu, IconSearch, IconLogout, IconMore, IconChevronLeft } from './Icons';
import ConnectivityBanner from './ConnectivityBanner';
import SearchModal from './SearchModal';

/* ------------------------------------------------------------------ */
/* Shell context: what screens need from the chrome                     */
/* ------------------------------------------------------------------ */
const ShellContext = createContext(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used inside <AppShell>');
  return ctx;
}

/** Screens call this to set the topbar (mockup `setTopTitle` + `topSub` +
 *  the "+ New patient" button slot). Resets when the screen unmounts.
 *    useTopbar({ sub: 'Registration · 2 patients', actions: <button …/> }) */
export function useTopbar({ title, sub, actions } = {}) {
  const { setTopbar } = useShell();
  useEffect(() => {
    setTopbar({ title, sub, actions });
    return () => setTopbar({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, sub, actions]);
}

/* ------------------------------------------------------------------ */
/* Pieces                                                               */
/* ------------------------------------------------------------------ */
function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="clock">
      {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
      <b id="clockTxt">{now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</b>
    </div>
  );
}

function Brand({ collapsed }) {
  return (
    <div className="sidenav-brand">
      <div className="sidenav-mark">
        <img src="/logo.jpg" alt="" />
      </div>
      {!collapsed && (
        <div className="sidenav-wordmark">
          <div className="w">{HOSPITAL_WORDMARK}</div>
          <div className="s">{HOSPITAL_SUBTITLE}</div>
        </div>
      )}
    </div>
  );
}

function Credit({ className }) {
  return (
    <div className={className}>
      <u>created by</u> <b>ai</b>
      <i>4</i>
      <u>work</u>
    </div>
  );
}

/* Desktop SideNav: 244px, labelled, two groups, collapsible to a 72px icon rail.
   The active item carries three signals — ground, white label, gold bar
   (or a gold icon when collapsed). */
function SideNav({ items, activeKey, currentUser, onLogout, queueTotal, collapsed, onToggle }) {
  const today = items.filter((i) => i.section === 'today');
  const manage = items.filter((i) => i.section === 'manage');
  const initials = (currentUser?.name || '?')
    .split(' ')
    .filter((w) => w && !/^dr\.?$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  const roleLabel = ROLE_LABELS[currentUser?.role] || currentUser?.role;
  const renderItem = (it) => {
    const Icon = it.icon;
    const active = activeKey === it.key;
    const count = it.key === 'queue' && queueTotal != null ? queueTotal : null;
    return (
      <NavLink
        key={it.key}
        to={it.path}
        className={`sidenav-item${active ? ' active' : ''}`}
        id={`nav-${it.key}`}
        title={collapsed ? it.fullLabel : undefined}
        aria-label={collapsed ? it.fullLabel : undefined}
        aria-current={active ? 'page' : undefined}
      >
        <Icon />
        <span className="sidenav-label">{it.fullLabel}</span>
        {count != null && <span className="sidenav-count">{count}</span>}
      </NavLink>
    );
  };
  return (
    <nav className={`sidenav gk-on-navy${collapsed ? ' collapsed' : ''}`} aria-label="Main">
      <Brand collapsed={collapsed} />
      <div className="sidenav-group">Today</div>
      {today.map(renderItem)}
      <div className="sidenav-group">Manage</div>
      {manage.map(renderItem)}
      <div className="sidenav-spacer" />
      <div className="sidenav-user" title={`${currentUser?.name} · ${roleLabel}`}>
        <div className="avatar">{initials || '?'}</div>
        <div className="sidenav-user-text">
          <div className="n">{currentUser?.name}</div>
          <div className="r">{roleLabel}</div>
        </div>
        <button onClick={onLogout} aria-label="Sign out" title="Sign out">
          <IconLogout />
        </button>
      </div>
      <button
        className="sidenav-collapse"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
      >
        <IconChevronLeft />
        {!collapsed && <span>Collapse</span>}
      </button>
      {!collapsed && <Credit className="sidenav-foot" />}
    </nav>
  );
}

/* Mobile overflow sheet (behind "More" and the top-left nav trigger): the
   SideNav's list on a navy sheet over the scrim, plus the queue stages. */
function MobileNavDrawer({
  open,
  onClose,
  items,
  activeKey,
  stages,
  stageCounts,
  currentStage,
  currentUser,
  onLogout,
}) {
  const today = items.filter((i) => i.section === 'today');
  const manage = items.filter((i) => i.section === 'manage');
  const renderItem = (it) => {
    const Icon = it.icon;
    return (
      <NavLink
        key={it.key}
        to={it.path}
        className={`mobile-nav-admin${activeKey === it.key ? ' active' : ''}`}
        onClick={onClose}
        aria-current={activeKey === it.key ? 'page' : undefined}
      >
        <Icon />
        <span>{it.fullLabel}</span>
      </NavLink>
    );
  };
  return (
    <>
      <div
        className={`mobile-nav-overlay${open ? ' show' : ''}`}
        onClick={onClose}
        data-testid="mobile-nav-overlay"
      />
      <div
        className={`mobile-nav-drawer gk-on-navy${open ? ' show' : ''}`}
        id="mobileNavDrawer"
        aria-hidden={!open}
        aria-label="Navigation"
      >
        <div className="mobile-nav-head">
          <Brand />
          <button onClick={onClose} aria-label="Close menu">
            ✕
          </button>
        </div>
        <div className="mobile-nav-group">Today</div>
        {today.map(renderItem)}
        <div className="mobile-nav-group">Queue stages</div>
        <div id="mobileNavStageList">
          {stages.map((st) => (
            <NavLink
              key={st.key}
              to={`/queue/${st.key}`}
              className={`mobile-nav-item${activeKey === 'queue' && currentStage === st.key ? ' active' : ''}`}
              onClick={onClose}
            >
              <span>{st.label}</span>
              <b>{stageCounts[st.key] ?? 0}</b>
            </NavLink>
          ))}
        </div>
        <div className="mobile-nav-group">Manage</div>
        {manage.map(renderItem)}
        <div className="mobile-nav-user">
          <span>
            {currentUser?.name}
            <br />
            <small>{ROLE_LABELS[currentUser?.role] || currentUser?.role}</small>
          </span>
          <button onClick={onLogout}>Sign out</button>
        </div>
        <Credit className="mobile-nav-foot" />
      </div>
    </>
  );
}

/* BottomTabBar: four everyday destinations in the thumb arc, then "More". */
function BottomNav({ items, activeKey, onMenu, queueTotal, menuOpen }) {
  const shown = BOTTOM_NAV_KEYS.map((k) => items.find((i) => i.key === k)).filter(Boolean);
  return (
    <nav className="bottomnav mobile-bottom-nav gk-on-navy" aria-label="Main">
      {shown.map((it) => {
        const Icon = it.icon;
        const active = activeKey === it.key;
        return (
          <NavLink
            key={it.key}
            to={it.path}
            className={`bottomnav-item mbn-item${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon />
            <span>{it.label}</span>
            {it.key === 'queue' && queueTotal > 0 && <span className="bottomnav-badge">{queueTotal}</span>}
          </NavLink>
        );
      })}
      <button className={`bottomnav-item mbn-item${menuOpen ? ' active' : ''}`} onClick={onMenu} aria-label="More">
        <IconMore />
        <span>More</span>
      </button>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                                */
/* ------------------------------------------------------------------ */
export default function AppShell() {
  const { currentUser, logout } = useAuth();
  const deviceMode = useDeviceMode();
  const isMobile = deviceMode === 'mobile';
  const location = useLocation();
  const params = useParams();
  const navigate = useNavigate();

  const [topbar, setTopbarState] = useState({});
  const setTopbar = useCallback((t) => setTopbarState(t || {}), []);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem('gk_nav_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggleNav = useCallback(() => {
    setNavCollapsed((v) => {
      try {
        localStorage.setItem('gk_nav_collapsed', v ? '0' : '1');
      } catch {
        /* private mode — fine */
      }
      return !v;
    });
  }, []);

  const [stages, setStages] = useState(DEFAULT_STAGES);
  const [stageCounts, setStageCounts] = useState({});

  const role = currentUser?.role;
  const items = useMemo(() => navItemsForRole(role), [role]);
  const activeKey = activeNavKey(location.pathname);
  const currentStage = activeKey === 'queue' ? params.stage || stages[0]?.key : null;

  // Stage list + per-stage counts (rail badge + mobile menu). Mock mode refreshes
  // on store change; real mode polls every 30s.
  const refreshCounts = useCallback(async () => {
    try {
      const [st, counts] = await Promise.all([admin.stages.list(), visits.counts()]);
      if (Array.isArray(st) && st.length) setStages(st);
      if (counts && typeof counts === 'object') setStageCounts(counts);
    } catch {
      /* endpoint not there yet — keep defaults */
    }
  }, []);
  useEffect(() => {
    refreshCounts();
    const unsub = onDataChange(refreshCounts);
    const t = setInterval(refreshCounts, 30000);
    return () => {
      unsub();
      clearInterval(t);
    };
  }, [refreshCounts]);

  // Close the mobile nav when leaving mobile mode (mockup setDeviceMode → closeMobileNav)
  useEffect(() => {
    if (!isMobile) setMobileNavOpen(false);
  }, [isMobile]);
  // …and on navigation
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  // Keyboard: Ctrl/Cmd+K or "/" opens search
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const queueTotal = useMemo(
    () => stages.filter((s) => s.key !== 'done').reduce((n, s) => n + (stageCounts[s.key] || 0), 0),
    [stages, stageCounts]
  );

  const title = topbar.title ?? (isMobile ? HOSPITAL_SHORT : HOSPITAL_NAME);
  const sub = topbar.sub ?? `${DOCTOR_NAME} · ${ROLE_LABELS[role] || 'Staff'}`;

  const ctx = useMemo(
    () => ({
      deviceMode,
      isMobile,
      setTopbar,
      openSearch: () => setSearchOpen(true),
      closeSearch: () => setSearchOpen(false),
      openMobileNav: () => setMobileNavOpen(true),
      closeMobileNav: () => setMobileNavOpen(false),
      stages,
      stageCounts,
      refreshCounts,
      navItems: items,
    }),
    [deviceMode, isMobile, setTopbar, stages, stageCounts, refreshCounts, items]
  );

  return (
    <ShellContext.Provider value={ctx}>
      <div className={`app${navCollapsed && !isMobile ? ' nav-collapsed' : ''}`} data-device={deviceMode}>
        {!isMobile && (
          <SideNav
            items={items}
            activeKey={activeKey}
            currentUser={currentUser}
            onLogout={handleLogout}
            queueTotal={queueTotal}
            collapsed={navCollapsed}
            onToggle={toggleNav}
          />
        )}
        <div className="main">
          <header className="topbar">
            <div className="topbar-lead">
              <button
                className="nav-trigger hamburger-btn"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
              >
                <IconMenu />
              </button>
              <div style={{ minWidth: 0 }}>
                <h1 id="topTitle">{title}</h1>
                <div className="sub" id="topSub">
                  {sub}
                  {USE_MOCKS && !isMobile && <span className="faint"> · demo data</span>}
                </div>
              </div>
            </div>
            <div className="topbar-right">
              <button
                className="icon-btn"
                onClick={() => setSearchOpen(true)}
                title="Search patients (Ctrl+K)"
                aria-label="Search patients"
              >
                <IconSearch />
              </button>
              {!isMobile && <Clock />}
              {topbar.actions}
            </div>
          </header>
          <ConnectivityBanner />
          <Outlet />
        </div>
      </div>

      {isMobile && (
        <>
          <MobileNavDrawer
            open={mobileNavOpen}
            onClose={() => setMobileNavOpen(false)}
            items={items}
            activeKey={activeKey}
            stages={stages}
            stageCounts={stageCounts}
            currentStage={currentStage}
            currentUser={currentUser}
            onLogout={handleLogout}
          />
          <BottomNav
            items={items}
            activeKey={activeKey}
            onMenu={() => setMobileNavOpen(true)}
            queueTotal={queueTotal}
            menuOpen={mobileNavOpen}
          />
        </>
      )}

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} stages={stages} />
    </ShellContext.Provider>
  );
}

export { NAV_ITEMS };
