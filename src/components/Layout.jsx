import React, { useState, useEffect } from "react";
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
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { focusRing } from "./ui";
import logo from "../assets/logo.jpg";
import { getSettings } from "../utils/api";

// Admin navigation
const adminNavItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/admin/dashboard" },
  { label: "Student Entry", icon: UserPlus, path: "/admin/students" },
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
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch(() => {
        // Widget just won't render if settings can't be loaded.
      });
  }, []);

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
        {/* ---------- Sidebar ---------- */}
        <aside
          className={`relative flex flex-shrink-0 flex-col bg-gradient-to-b from-[#1e3a8a] to-[#1d4ed8] shadow-xl transition-all duration-200 ${
            collapsed ? "w-20" : "w-64"
          }`}
        >
          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`absolute -right-3 top-8 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[#1e3a8a] text-slate-300 shadow-md transition-colors hover:bg-[#0ea5e9] hover:text-white ${
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
                  SCHOOL
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
          <header className="flex flex-shrink-0 flex-col gap-3 border-b border-[#e2e8f0] bg-white/90 px-6 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
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

            <div className="flex flex-shrink-0 items-center gap-3">
              <div className="group relative hidden md:block">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#0ea5e9]"
                />
                <input
                  type="text"
                  placeholder="Search students by name or ID…"
                  className="w-56 rounded-full border border-[#e2e8f0] bg-[#f1f5f9] py-2 pl-9 pr-4 text-sm text-slate-600 placeholder:text-slate-400 transition-all focus:w-64 focus:border-[#0ea5e9] focus:bg-white focus:shadow-[0_0_0_3px_rgba(14,165,233,0.15)] focus:outline-none"
                />
              </div>
              <button
                aria-label="Notifications"
                className={`relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[#e2e8f0] text-slate-500 transition-colors hover:border-[#0ea5e9]/40 hover:bg-[#0ea5e9]/10 hover:text-[#0ea5e9] ${
                  focusRing || ""
                }`}
              >
                <Bell size={16} />
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#0ea5e9] ring-2 ring-white" />
              </button>
              <button
                onClick={handleLogout}
                className={`flex flex-shrink-0 items-center gap-2 rounded-full border border-[#e2e8f0] py-1 pl-1 pr-3 transition-colors hover:bg-[#f1f5f9] ${
                  focusRing || ""
                }`}
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1e3a8a] font-mono text-xs font-semibold text-[#0ea5e9]">
                  {userInitials}
                </div>
                <span className="hidden text-sm font-medium text-slate-600 md:inline">
                  {user?.name || "Admin"}
                </span>
              </button>
            </div>
          </header>

          {/* Routed page content — this is the ONLY thing that scrolls. */}
          <main className="min-h-0 flex-1 overflow-y-auto overflow-x-auto px-6 py-6">
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
