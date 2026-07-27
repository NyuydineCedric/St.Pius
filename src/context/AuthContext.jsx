import React, { createContext, useState, useContext, useEffect } from "react";
import {
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  setToken,
  getToken,
  AUTH_EXPIRED_EVENT,
} from "../utils/api";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedUser = localStorage.getItem("userData");
    const token = getToken();
    if (storedUser && token) {
      setUser(JSON.parse(storedUser));
    } else {
      localStorage.removeItem("userData");
      localStorage.removeItem("userRole");
      setToken(null);
    }
    setLoading(false);
  }, []);

  // Keep React auth state in sync when an API call gets 401.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const login = async (email, password) => {
    const data = await apiLogin(email, password);
    if (!data.token) {
      throw new Error("Login did not return a session token");
    }
    setToken(data.token);
    const userData = {
      id: data.id,
      name: data.name,
      email: data.email,
      role: data.role,
    };

    localStorage.setItem("userData", JSON.stringify(userData));
    localStorage.setItem("userRole", data.role);
    setUser(userData);
    return userData;
  };

  const register = async (name, email, password, role) => {
    return apiRegister(name, email, password, role);
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch {
      /* ignore network errors on logout */
    }
    setToken(null);
    localStorage.removeItem("userData");
    localStorage.removeItem("userRole");
    setUser(null);
  };

  const value = {
    user,
    loading,
    login,
    register,
    logout,
    isAdmin: user?.role === "admin",
    isTeacher: user?.role === "teacher",
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
