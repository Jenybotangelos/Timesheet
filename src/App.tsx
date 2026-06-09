import { useState, useEffect } from "react"
import { Routes, Route } from "react-router-dom"
import { useMsal } from "@azure/msal-react"
import Dashboard from "./pages/Dashboard"
import WorkingHoursEditor from "./pages/WorkingHoursEditor"
import TaskSubmission from "./pages/TaskSubmission"
import Login from "./pages/Login"

const API_BASE = "/api";

interface User {
  id: number;
  name: string;
  email: string;
}

function App() {
  const { instance, accounts } = useMsal();
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem("tasksheet_user");
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    instance.handleRedirectPromise().then(async (result) => {
      if (result && result.account) {
        const email = result.account.username;
        if (!email.toLowerCase().endsWith("@botangelos.com")) {
          alert("Only @botangelos.com accounts are allowed");
          instance.logoutRedirect();
          return;
        }

        // Call backend to register/login
        try {
          const res = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, idToken: result.idToken }),
          });

          if (res.ok) {
            const userData = await res.json();
            localStorage.setItem("tasksheet_user", JSON.stringify(userData));
            setUser(userData);
          }
        } catch (err) {
          console.error("Backend login failed:", err);
        }
      }
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  function handleLogout() {
    localStorage.removeItem("tasksheet_user");
    setUser(null);
    instance.logoutRedirect();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460] flex items-center justify-center">
        <p className="text-white/60">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <Routes>
      <Route path="/" element={<Dashboard userEmail={user.email} onLogout={handleLogout} />} />
      <Route path="/edit" element={<WorkingHoursEditor userEmail={user.email} />} />
      <Route path="/submit" element={<TaskSubmission userEmail={user.email} />} />
    </Routes>
  )
}

export default App
