import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Mail,
  Eye,
  EyeOff,
  Lock,
  TriangleAlert,
  ArrowLeft,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";

const LoginPage = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Please fill in all the fields");
      return;
    }

    setLoading(true);
    try {
      const user = await login(email, password);
      // Redirect based on role
      if (user.role === "admin") {
        navigate("/admin/dashboard");
      } else if (user.role === "teacher") {
        navigate("/teacher/dashboard");
      } else {
        navigate("/dashboard");
      }
    } catch (err) {
      setError(err.message || "Login failed. Please try again");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="min-h-screen items-center bg-[#e8eef9]  justify-center flex px-4 py-8 relative  overflow:hidden">
      <div className="absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 49px, rgba(37,99,235, 0.05) 49px, rgba(37,99,235, 0.05) 50px),
                                      repeating-linear-gradient(90deg, transparent, transparent 49px, rgba(37,99,235, 0.05) 49px, rgba(37,99,235, 0.05) 50px)`,
            backgroundSize: "50px 50px",
          }}
        ></div>
      </div>
      <div className="border absolute bg-white md:w-88 border-white p-8 rounded-xs shadow-xl">
        <div className="cursor-pointer" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5 text-[#64748B] hover:text-[#2563EB] transition" />
        </div>
        <div className="text-center mb-2">
          <h2 className="text-[25px] font-bold text-[#1b2336] mb-1">
            Welcome Back!
          </h2>
          <p className="text-[#64748B] text-sm">
            Login to your account and continue
          </p>
        </div>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <TriangleAlert className="w-4 h-4" />
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm font-semibold text-[#0F172A]">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute top-1/2 left-3 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
              <input
                type="email"
                value={email}
                placeholder="Enter your email"
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xs bg-white/5 border border-[#E2E8F0] text-[#0F172A] placeholder-[#64748B] focus:outline-none transition"
                required
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold text-[#0F172A]">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute top-1/2 left-3 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                placeholder="Enter your password"
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 text-sm pr-4 py-2.5 rounded-xs bg-white/5  border border-[#E2E8F0] text-[#0F172A] placeholder-[#64748B] focus:outline-none  transition"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute cursor-pointer right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-grey-500 transition"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="flex justify-between mt-3">
              <div className="flex gap-2 items-center">
                <input
                  type="checkbox"
                  className="focus:outline-blue-600 border-blue-600"
                />
                <p className="text-sm">Remember Me</p>
              </div>
              <p className="text-[#2563EB] font-semibold text-sm">
                Forgot Password?
              </p>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-xs cursor-pointer bg-[#2563EB] text-white font-semibol transition flex items-center justify-center gap-2"
          >
            {loading ? "Processing..." : <>Login</>}
          </button>
          <div className="flex items-center">
            <span className="h-[1px] border border-[#E2E8F0] w-[25%]"></span>
            <span className="text-sm text-[#64748B] mr-5 ml-5">
              or continue with
            </span>
            <span className="h-[1px] border border-[#E2E8F0] w-[25%]"></span>
          </div>

          <button
            type="button"
            className="w-full py-2 rounded-xs cursor-pointer text-black border border-[#E2E8F0] font-semibold hover:bg-gray-200 transition transform  flex items-center justify-center gap-2"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Google
          </button>
        </form>
        <div className="mt-2 text-center">
          <p className="text-gray-400 text-sm">
            Don't have an account?{" "}
            <Link
              to="/register"
              className="text-[#2563EB] cursor-pointer hover:underline font-medium"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};
export default LoginPage;
