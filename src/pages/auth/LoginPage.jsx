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
      <div className="relative border bg-white w-full max-w-sm border-white p-6 sm:p-8 rounded-xs shadow-xl">
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
