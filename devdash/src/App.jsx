import { NavLink, Route, Routes } from "react-router-dom";
import LicensePage from "./pages/LicensePage.jsx";
import SchoolsPage from "./pages/SchoolsPage.jsx";
import ConfigPage from "./pages/ConfigPage.jsx";

export default function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>St. Pius Dev</h1>
        <nav className="nav">
          <NavLink to="/" end>
            Licences
          </NavLink>
          <NavLink to="/schools">Schools</NavLink>
          <NavLink to="/config">Config</NavLink>
        </nav>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<LicensePage />} />
          <Route path="/schools" element={<SchoolsPage />} />
          <Route path="/config" element={<ConfigPage />} />
        </Routes>
      </main>
    </div>
  );
}
