import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  UserPlus,
  PenSquare,
  Users,
  FileText,
  TrendingUp,
  RotateCcw,
  Settings as SettingsIcon,
  Search,
  Bell,
  ChevronRight,
  ChevronLeft,
  GraduationCap,
  LogOut,
  IdCard,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { focusRing } from "./ui";
import logo from "../assets/logo.jpg";
import {
  getSettings,
  getStudents,
  getActivities,
  getTeachers,
} from "../utils/api";

// Admin navigation
const adminNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/admin/dashboard" },
  { label: "Student Entry", icon: UserPlus, path: "/admin/students" },
  { label: "Student Cards", icon: IdCard, path: "/admin/student-cards" },
  { label: "Marks Entry", icon: PenSquare, path: "/admin/marks" },
  { label: "Classes", icon: Users, path: "/admin/classes" },
  { label: "Report Cards", icon: FileText, path: "/admin/report-cards" },
  { label: "Performance", icon: TrendingUp, path: "/admin/performance" },
  { label: "Activities", icon: RotateCcw, path: "/admin/activities" },
  { label: "Settings", icon: SettingsIcon, path: "/admin/settings" },
];

// Teacher navigation
const teacherNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/teacher/dashboard" },
  { label: "My Marks Entry", icon: GraduationCap, path: "/teacher/marks" },
  { label: "My Students", icon: Users, path: "/teacher/students" },
];

const termOrder = ["First Term", "Second Term", "Third Term"];
const sequenceOrder = [
  "Sequence 1",
  "Sequence 2",
  "Sequence 3",
  "Sequence 4",
  "Sequence 5",
  "Sequence 6",
];

const notifIconByType = {
  Student: UserPlus,
  Marks: PenSquare,
  "Report Card": FileText,
  Class: Users,
  Staff: GraduationCap,
  Account: Users,
};

function lastSeenKey(userId) {
  return `notificationsLastSeen:${userId || "anon"}`;
}

/**
 * Teachers only see activity about their assigned classes (marks/reports)
 * or staff notes that name them — not admin school-management noise.
 */
function filterNotificationsForUser(list, user, teacherCtx) {
  if (!Array.isArray(list)) return [];
  if (user?.role !== "teacher") return list;

  const classes = teacherCtx?.classes || [];
  const name = (teacherCtx?.name || "").trim();

  return list.filter((n) => {
    const text = n.text || "";
    if (n.type === "Marks" || n.type === "Report Card") {
      if (classes.length === 0) return false;
      return classes.some((cls) => text.includes(cls));
    }
    if (n.type === "Staff" && name) {
      return text.includes(name);
    }
    return false;
  });
}

function relativeTime(timestamp) {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

function getTermProgress(settings) {
  if (!settings) return null;
  const termNumber = termOrder.indexOf(settings.currentTerm) + 1;
  const sequenceNumber = sequenceOrder.indexOf(settings.currentSequence) + 1;
  if (termNumber <= 0 || sequenceNumber <= 0) return null;
  const percent = Math.round((sequenceNumber / sequenceOrder.length) * 100);
  return { termNumber, sequenceNumber, percent };
}

function NavList({ collapsed, navItems }) {
  return (
    <ul className="flex flex-col gap-1">
      {navItems.map(({ label, icon: Icon, path }) => (
        <li key={label}>
          <NavLink
            to={path}
            end={path === "/"}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 active:scale-[0.98] ${
                focusRing || ""
              } focus-visible:ring-offset-[#1e3a8a] ${
                collapsed ? "justify-center" : "w-full"
              } ${
                isActive
                  ? "bg-[#0ea5e9]/15 text-[#0ea5e9] shadow-[inset_0_0_0_1px_rgba(14,165,233,0.25)]"
                  : "text-slate-300 hover:bg-white/10 hover:text-white"
              }`
            }
          >
            <Icon size={18} strokeWidth={2} className="flex-shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  // Sidebar becomes an off-canvas drawer below the lg breakpoint — closed
  // by default so it doesn't eat the whole screen on phones/tablets.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settings, setSettings] = useState(null);
  const [headerSearch, setHeaderSearch] = useState("");
  const [allStudents, setAllStudents] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchWrapRef = useRef(null);
  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(0);
  const [panelBaseline, setPanelBaseline] = useState(null);
  const notifWrapRef = useRef(null);
  const [teacherCtx, setTeacherCtx] = useState({ name: "", classes: [] });

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch(() => {
        // Widget just won't render if settings can't be loaded.
      });
  }, []);

  // Close the mobile drawer whenever the route changes (e.g. after tapping
  // a nav link), so it doesn't stay open over the new page.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Teachers: load assigned classes so the bell can hide admin-only noise.
  useEffect(() => {
    if (user?.role !== "teacher" || !user?.email) {
      setTeacherCtx({ name: "", classes: [] });
      return;
    }
    getTeachers()
      .then((list) => {
        const mine = list.find(
          (t) =>
            t.email?.trim().toLowerCase() === user.email.trim().toLowerCase(),
        );
        if (!mine) {
          setTeacherCtx({ name: "", classes: [] });
          return;
        }
        setTeacherCtx({
          name: mine.name || "",
          classes: [
            ...new Set(
              (mine.assignments || []).map((a) => a.class).filter(Boolean),
            ),
          ],
        });
      })
      .catch(() => setTeacherCtx({ name: "", classes: [] }));
  }, [user?.role, user?.email]);

  // Keep header search results fresh when navigating between pages.
  useEffect(() => {
    getStudents()
      .then(setAllStudents)
      .catch(() => {
        /* header search stays empty if students can't load */
      });
  }, [location.pathname]);

  useEffect(() => {
    if (!user?.id) {
      setLastSeen(0);
      return;
    }
    const key = lastSeenKey(user.id);
    const raw = localStorage.getItem(key);
    if (raw != null) {
      setLastSeen(Number(raw) || 0);
    } else {
      // First visit: don't flood the badge with the whole activity history.
      const now = Date.now();
      localStorage.setItem(key, String(now));
      setLastSeen(now);
    }
  }, [user?.id]);

  const refreshNotifications = useCallback(() => {
    getActivities()
      .then((list) => setNotifications(Array.isArray(list) ? list : []))
      .catch(() => {
        /* bell stays empty if activities can't load */
      });
  }, []);

  useEffect(() => {
    refreshNotifications();
    const id = setInterval(refreshNotifications, 30_000);
    return () => clearInterval(id);
  }, [location.pathname, refreshNotifications]);

  useEffect(() => {
    function onDocClick(e) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
      if (notifWrapRef.current && !notifWrapRef.current.contains(e.target)) {
        setNotifOpen(false);
        setPanelBaseline(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const headerMatches = useMemo(() => {
    const q = headerSearch.trim().toLowerCase();
    if (!q) return [];
    return allStudents
      .filter((s) => `${s.name} ${s.id} ${s.class}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [allStudents, headerSearch]);

  const visibleNotifications = useMemo(
    () => filterNotificationsForUser(notifications, user, teacherCtx),
    [notifications, user, teacherCtx],
  );

  const recentNotifications = useMemo(
    () => visibleNotifications.slice(0, 8),
    [visibleNotifications],
  );

  const unreadCount = useMemo(
    () =>
      visibleNotifications.filter((n) => (n.timestamp || 0) > lastSeen).length,
    [visibleNotifications, lastSeen],
  );

  function markNotificationsSeen(list = visibleNotifications) {
    const maxTs = list.reduce(
      (max, n) => Math.max(max, n.timestamp || 0),
      Date.now(),
    );
    setLastSeen(maxTs);
    if (user?.id) {
      localStorage.setItem(lastSeenKey(user.id), String(maxTs));
    }
  }

  function toggleNotifications() {
    const opening = !notifOpen;
    setNotifOpen(opening);
    setSearchOpen(false);
    if (opening) {
      setPanelBaseline(lastSeen);
      getActivities()
        .then((list) => {
          const next = Array.isArray(list) ? list : [];
          setNotifications(next);
          markNotificationsSeen(
            filterNotificationsForUser(next, user, teacherCtx),
          );
        })
        .catch(() => {
          markNotificationsSeen();
        });
    } else {
      setPanelBaseline(null);
    }
  }

  const studentsPath =
    user?.role === "teacher" ? "/teacher/students" : "/admin/students";
  const reportCardsPath =
    user?.role === "teacher" ? "/teacher/report-cards" : "/admin/report-cards";
  const activitiesPath = user?.role === "admin" ? "/admin/activities" : null;

  function goToStudentsSearch(query) {
    const q = (query ?? headerSearch).trim();
    setSearchOpen(false);
    if (user?.role === "teacher") {
      navigate(q ? `${studentsPath}?q=${encodeURIComponent(q)}` : studentsPath);
      return;
    }
    navigate(q ? `${studentsPath}?q=${encodeURIComponent(q)}` : studentsPath);
  }

  function openStudentReports(student) {
    setSearchOpen(false);
    setHeaderSearch("");
    navigate(reportCardsPath, {
      state: { className: student.class, studentId: student.id },
    });
  }

  const progress = getTermProgress(settings);

  // Determine which nav items to show based on role
  const navItems = user?.role === "admin" ? adminNavItems : teacherNavItems;

  const current =
    navItems.find((n) =>
      n.path === "/"
        ? location.pathname === "/"
        : location.pathname.startsWith(n.path),
    )?.label || "Dashboard";

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  // Get user initials for avatar
  const userInitials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "AD";

  return (
    <div className="min-h-screen bg-[#f1f5f9] font-sans text-[#1e293b] antialiased">
      <div className="flex min-h-screen">
        {/* Dimmed backdrop behind the mobile drawer — tap to close. Only
            ever rendered below the lg breakpoint. */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* ---------- Sidebar ----------
            Below lg: fixed off-canvas drawer, slid in/out with mobileOpen.
            At lg and up: a normal, always-visible flex column that can
            still collapse to icon-only width via `collapsed`. */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-shrink-0 flex-col bg-gradient-to-b from-[#1e3a8a] to-[#1d4ed8] shadow-xl transition-transform duration-200 lg:relative lg:z-auto lg:translate-x-0 lg:transition-[width] ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          } ${collapsed ? "lg:w-20" : "lg:w-64"}`}
        >
          {/* Mobile-only close button */}
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className={`absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white lg:hidden ${
              focusRing || ""
            }`}
          >
            <X size={18} />
          </button>

          {/* Collapse toggle — desktop only; on mobile the drawer is either
              fully open or fully closed, so icon-only collapsing doesn't apply. */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`absolute -right-3 top-8 hidden h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[#1e3a8a] text-slate-300 shadow-md transition-colors hover:bg-[#0ea5e9] hover:text-white lg:flex ${
              focusRing || ""
            }`}
          >
            {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
          </button>

          {/* Logo */}
          <div
            className={`flex items-center gap-3 px-4 py-6 ${
              collapsed ? "justify-center px-2" : ""
            }`}
          >
            <img
              src={logo}
              alt="School logo"
              className="w-10 h-10 rounded-full flex-shrink-0 object-cover"
            />
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate text-lg font-bold leading-tight tracking-tight text-white">
                  ST.PIUS X
                </div>
                <div className="truncate text-[11px] uppercase tracking-wider text-slate-400">
                  Records System
                </div>
              </div>
            )}
          </div>

          <div className="mx-4 h-px bg-white/10" />

          {/* Navigation — only the nav list itself scrolls internally if
              it's ever too tall for the viewport; the sidebar frame
              itself never grows. */}
          <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
            <NavList collapsed={collapsed} navItems={navItems} />
          </nav>

          {/* User info & logout */}
          <div className="mx-3 mb-4 rounded-lg bg-white/10 p-3 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-semibold text-white">
                {userInitials}
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">
                    {user?.name || "User"}
                  </div>
                  <div className="truncate text-xs text-slate-300">
                    {user?.role === "admin" ? "Administrator" : "Teacher"}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={handleLogout}
              className={`mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white ${
                collapsed ? "justify-center" : ""
              }`}
            >
              <LogOut size={16} />
              {!collapsed && <span>Logout</span>}
            </button>
          </div>

          {/* Term progress widget */}
          {!collapsed && progress && (
            <div className="mx-4 mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>Term {progress.termNumber} of 3</span>
                <span className="font-mono font-semibold text-[#0ea5e9]">
                  {progress.percent}%
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#0ea5e9] transition-all duration-500"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                Sequence {progress.sequenceNumber} of 6 in progress
              </div>
            </div>
          )}
        </aside>

        {/* ---------- Main column (own fixed height, own internal scroll) ---------- */}
        <div className="flex h-screen min-w-0 flex-1 flex-col">
          {/* Top bar — no longer needs "sticky"; it's naturally pinned
              since only the content below it scrolls, not the whole page. */}
          <header className="flex flex-shrink-0 flex-col gap-3 border-b border-[#e2e8f0] bg-white/90 px-4 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[#e2e8f0] text-slate-500 hover:border-[#0ea5e9]/40 hover:bg-[#0ea5e9]/10 hover:text-[#0ea5e9] lg:hidden ${
                  focusRing || ""
                }`}
              >
                <Menu size={18} />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span>SCHOOL</span>
                  <ChevronRight size={12} />
                  <span className="font-medium text-[#0ea5e9]">{current}</span>
                </div>
                <h1 className="truncate text-2xl font-bold tracking-tight text-[#1e3a8a]">
                  {current}
                </h1>
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center gap-3">
              <div
                className="group relative hidden md:block"
                ref={searchWrapRef}
              >
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#0ea5e9]"
                />
                <input
                  type="search"
                  value={headerSearch}
                  onChange={(e) => {
                    setHeaderSearch(e.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      goToStudentsSearch();
                    }
                    if (e.key === "Escape") setSearchOpen(false);
                  }}
                  placeholder="Search students by name or ID…"
                  className="w-56 rounded-full border border-[#e2e8f0] bg-[#f1f5f9] py-2 pl-9 pr-4 text-sm text-slate-600 placeholder:text-slate-400 transition-all focus:w-64 focus:border-[#0ea5e9] focus:bg-white focus:shadow-[0_0_0_3px_rgba(14,165,233,0.15)] focus:outline-none"
                />
                {searchOpen && headerSearch.trim() && (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-80 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-lg">
                    {headerMatches.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-slate-400">
                        No students match “{headerSearch.trim()}”
                      </p>
                    ) : (
                      <ul className="max-h-72 overflow-y-auto py-1">
                        {headerMatches.map((s) => (
                          <li key={s.id}>
                            <button
                              type="button"
                              onClick={() => openStudentReports(s)}
                              className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-[#f1f5f9]"
                            >
                              <span className="text-sm font-medium text-[#1e3a8a]">
                                {s.name}
                              </span>
                              <span className="text-xs text-slate-400">
                                {s.id} · {s.class}
                                {s.option ? ` · ${s.option}` : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      onClick={() => goToStudentsSearch()}
                      className="w-full border-t border-[#e2e8f0] px-4 py-2.5 text-left text-sm font-medium text-[#0ea5e9] hover:bg-[#f1f5f9]"
                    >
                      View all matches in Students
                    </button>
                  </div>
                )}
              </div>
              {/* Teachers don't get the notification bell — admin-only. */}
              {user?.role !== "teacher" && (
              <div className="relative" ref={notifWrapRef}>
                <button
                  type="button"
                  aria-label="Notifications"
                  aria-expanded={notifOpen}
                  onClick={toggleNotifications}
                  className={`relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[#e2e8f0] text-slate-500 transition-colors hover:border-[#0ea5e9]/40 hover:bg-[#0ea5e9]/10 hover:text-[#0ea5e9] ${
                    notifOpen
                      ? "border-[#0ea5e9]/40 bg-[#0ea5e9]/10 text-[#0ea5e9]"
                      : ""
                  } ${focusRing || ""}`}
                >
                  <Bell size={16} />
                  {unreadCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0ea5e9] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-lg sm:w-96">
                    <div className="flex items-center justify-between border-b border-[#e2e8f0] px-4 py-3">
                      <p className="text-sm font-semibold text-[#1e3a8a]">
                        Notifications
                      </p>
                      <span className="text-xs text-slate-400">
                        {visibleNotifications.length === 0
                          ? "None yet"
                          : `${visibleNotifications.length} total`}
                      </span>
                    </div>
                    {recentNotifications.length === 0 ? (
                      <p className="px-4 py-8 text-center text-sm text-slate-400">
                        {user?.role === "teacher"
                          ? "No updates for your classes yet. Save marks or print a report card to see them here."
                          : "No activity yet. Enrol a student, enter marks, or print a report card to see updates here."}
                      </p>
                    ) : (
                      <ul className="max-h-80 overflow-y-auto">
                        {recentNotifications.map((item, i) => {
                          const Icon = notifIconByType[item.type] || FileText;
                          const unreadCutoff =
                            panelBaseline != null ? panelBaseline : lastSeen;
                          const isUnread = (item.timestamp || 0) > unreadCutoff;
                          return (
                            <li
                              key={`${item.timestamp}-${i}`}
                              className={`flex items-start gap-3 border-b border-[#e2e8f0]/70 px-4 py-3 last:border-0 ${
                                isUnread ? "bg-[#0ea5e9]/5" : "bg-white"
                              }`}
                            >
                              <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#1e3a8a] text-[#0ea5e9]">
                                <Icon size={14} />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm leading-snug text-[#1e293b]">
                                  {item.text}
                                </p>
                                <p className="mt-0.5 text-xs text-slate-400">
                                  {item.type}
                                  {item.timestamp
                                    ? ` · ${relativeTime(item.timestamp)}`
                                    : ""}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {activitiesPath && (
                      <button
                        type="button"
                        onClick={() => {
                          setNotifOpen(false);
                          navigate(activitiesPath);
                        }}
                        className="w-full border-t border-[#e2e8f0] px-4 py-2.5 text-left text-sm font-medium text-[#0ea5e9] hover:bg-[#f1f5f9]"
                      >
                        View all activity
                      </button>
                    )}
                  </div>
                )}
              </div>
              )}
              <div
                className="flex flex-shrink-0 items-center gap-2 rounded-full border border-[#e2e8f0] py-1 pl-1 pr-3"
                title={user?.email || user?.name || "Signed in"}
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1e3a8a] font-mono text-xs font-semibold text-[#0ea5e9]">
                  {userInitials}
                </div>
                <span className="hidden text-sm font-medium text-slate-600 md:inline">
                  {user?.name || "Admin"}
                </span>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                aria-label="Log out"
                title="Log out"
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[#e2e8f0] text-slate-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 ${
                  focusRing || ""
                }`}
              >
                <LogOut size={16} />
              </button>
            </div>
          </header>

          {/* Routed page content — this is the ONLY thing that scrolls. */}
          <main className="min-h-0 flex-1 overflow-y-auto overflow-x-auto px-4 py-6 sm:px-6">
            <Outlet />
            <footer className="mt-8 pb-4 text-center text-xs text-slate-400">
              SCHOOL Report Card &amp; Information System — Developed by
              Nyuydine Cedric and Baye Brian
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
