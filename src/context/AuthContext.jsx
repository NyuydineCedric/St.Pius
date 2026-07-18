import React, { createContext, useState, useContext, useEffect } from "react";
import { login as apiLogin, register as apiRegister } from "../utils/api";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check localStorage for existing session
    const storedUser = localStorage.getItem("userData");
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    const data = await apiLogin(email, password);
    const userData = {
      id: data.id,
      name: data.name,
      email: data.email,
      role: data.role, // 'admin' or 'teacher'
    };

    localStorage.setItem("userData", JSON.stringify(userData));
    localStorage.setItem("userRole", data.role);
    setUser(userData);
    return userData;
  };

  const register = async (name, email, password, role) => {
    return apiRegister(name, email, password, role);
  };

  const logout = () => {
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
