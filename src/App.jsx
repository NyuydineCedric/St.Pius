import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import LoginPage from "./pages/auth/LoginPage";
import RegisterPage from "./pages/auth/RegisterPage";
import LandingPage from "./pages/LandingPage";
import UserGuide from "./pages/UserGuide";
import HelpCenter from "./pages/HelpCenter";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsConditions from "./pages/TermsConditions";
import Layout from "./components/Layout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import StudentEntry from "./pages/admin/StudentEntry";
import StudentCards from "./pages/admin/StudentCards";
import MarksEntry from "./pages/admin/MarksEntry";
import Classes from "./pages/admin/Classes";
import Promotions from "./pages/admin/Promotions";
import ReportCards from "./pages/admin/ReportCards";
import Mastersheet from "./pages/admin/Mastersheet";
import Performance from "./pages/admin/Performance";
import Activities from "./pages/admin/Activities";
import Settings from "./pages/admin/Settings";
import TeacherDashboard from "./pages/teacher/TeacherDashboard";
import TeacherMarksEntry from "./pages/teacher/TeacherMarksEntry";
import MyStudents from "./pages/teacher/MyStudents";

function DashboardRedirect() {
  const { user } = useAuth();
  if (user?.role === "admin") return <Navigate to="/admin/dashboard" replace />;
  if (user?.role === "teacher")
    return <Navigate to="/teacher/dashboard" replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/user-guide" element={<UserGuide />} />
        <Route path="/help" element={<HelpCenter />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsConditions />} />

        {/* Admin Routes */}
        <Route
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/students" element={<StudentEntry />} />
          <Route path="/admin/student-cards" element={<StudentCards />} />
          <Route path="/admin/marks" element={<MarksEntry />} />
          <Route path="/admin/classes" element={<Classes />} />
          <Route path="/admin/promotions" element={<Promotions />} />
          <Route path="/admin/report-cards" element={<ReportCards />} />
          <Route path="/admin/mastersheet" element={<Mastersheet />} />
          <Route path="/admin/performance" element={<Performance />} />
          <Route path="/admin/activities" element={<Activities />} />
          <Route path="/admin/settings" element={<Settings />} />
        </Route>

        {/* Teacher Routes */}
        <Route
          element={
            <ProtectedRoute allowedRoles={["teacher"]}>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/teacher/dashboard" element={<TeacherDashboard />} />
          <Route path="/teacher/marks" element={<TeacherMarksEntry />} />
          <Route path="/teacher/report-cards" element={<ReportCards />} />
          <Route path="/teacher/students" element={<MyStudents />} />
        </Route>

        {/* Redirect /dashboard based on role */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardRedirect />
            </ProtectedRoute>
          }
        />

        {/* Unauthorized page */}
        <Route
          path="/unauthorized"
          element={
            <div className="min-h-screen flex items-center justify-center bg-[#e8eef9]">
              <div className="bg-white p-8 rounded-xl shadow-xl text-center">
                <h1 className="text-2xl font-bold text-red-600 mb-4">
                  Unauthorized Access
                </h1>
                <p className="text-gray-600">
                  You don't have permission to view this page.
                </p>
                <button
                  onClick={() => window.history.back()}
                  className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Go Back
                </button>
              </div>
            </div>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
