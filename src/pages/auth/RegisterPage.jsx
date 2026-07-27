import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Mail,
  Eye,
  EyeOff,
  Lock,
  TriangleAlert,
  User,
  ArrowLeft,
  Shield,
  Users,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { getAuthStatus } from "../../utils/api";

const RegisterPage = () => {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bootstrapAdmin, setBootstrapAdmin] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    getAuthStatus()
      .then((s) => {
        const needsAdmin = Boolean(s.bootstrapAdmin || !s.hasAdmin);
        setBootstrapAdmin(needsAdmin);
      })
      .catch(() => {
        setBootstrapAdmin(false);
      })
      .finally(() => setStatusLoaded(true));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!name || !email || !password) {
      setError("Please fill in all the fields");
      return;
    }

    if (password.length < 6) {
      setError("Password must contain at least 6 characters");
      return;
    }

    if (!agreed) {
      setError("Please agree to the Terms & Conditions");
      return;
    }

    setLoading(true);
    try {
      const submitRole = bootstrapAdmin ? "admin" : "teacher";
      await register(name, email, password, submitRole);
      navigate("/login");
    } catch (err) {
      setError(err.message || "Registration failed. Please try again");
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
            Create Account
          </h2>
          <p className="text-[#64748B] text-sm">
            {bootstrapAdmin
              ? "Set up the first administrator for this school"
              : "Register as a teacher to join your school"}
          </p>
        </div>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <TriangleAlert className="w-4 h-4" />
            {error}
          </div>
        )}
        {statusLoaded && (
          <div className="mb-3 p-2 rounded-md border border-[#E2E8F0] bg-[#F8FAFC]">
            <div className="flex items-center gap-2 justify-center">
              {bootstrapAdmin ? (
                <>
                  <Shield className="w-4 h-4 text-[#2563EB]" />
                  <span className="text-sm font-medium text-[#2563EB]">
                    Administrator (first account)
                  </span>
                </>
              ) : (
                <>
                  <Users className="w-4 h-4 text-[#2563EB]" />
                  <span className="text-sm font-medium text-[#2563EB]">
                    Teacher account
                  </span>
                </>
              )}
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm font-semibold text-[#0F172A]">Name</label>
            <div className="relative">
              <User className="absolute top-1/2 left-3 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
              <input
                type="text"
                value={name}
                placeholder="Enter your name"
                onChange={(e) => setName(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xs bg-white/5 border border-[#E2E8F0] text-[#0F172A] placeholder-[#64748B] focus:outline-none transition"
                required
              />
            </div>
          </div>
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

            <div className="flex gap-2 items-center mt-3 mb-3">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="focus:outline-blue-600 border-blue-600"
              />
              <p className="text-sm">
                I agree to the{" "}
                <Link to="/terms" className="text-blue-600">
                  Terms & Conditions
                </Link>
              </p>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || !statusLoaded}
            className="w-full py-2 rounded-xs cursor-pointer bg-[#155cf4] text-white font-semibol transition flex items-center justify-center gap-2"
          >
            {loading ? "Processing..." : <>Register</>}
          </button>
        </form>
        <div className="mt-2 text-center">
          <p className="text-gray-400 text-sm">
            Already have an account?{" "}
            <Link
              to="/login"
              className="text-[#2563EB] cursor-pointer hover:underline font-medium"
            >
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};
export default RegisterPage;
