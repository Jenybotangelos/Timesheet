import { useState, useEffect } from "react"
import { Routes, Route } from "react-router-dom"
import { useMsal } from "@azure/msal-react"
import Dashboard from "./pages/Dashboard"
import WorkingHoursEditor from "./pages/WorkingHoursEditor"
import TaskSubmission from "./pages/TaskSubmission"
import Projects from "./pages/Projects"
import Login from "./pages/Login"

const API_BASE = "/api";

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
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
      console.log("MSAL redirect result:", result);
      if (result && result.account) {
        const email = result.account.username;
        console.log("Logged in as:", email);
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
          console.log("Backend response status:", res.status);

          if (res.ok) {
            const userData = await res.json();
            localStorage.setItem("tasksheet_user", JSON.stringify(userData));
            setUser(userData);
          } else {
            const err = await res.json();
            console.error("Backend login error:", err);
            alert("Login failed: " + (err.error || "Unknown error"));
          }
        } catch (err) {
          console.error("Backend login failed:", err);
          alert("Failed to connect to backend API");
        }
      }
      setLoading(false);
    }).catch((err) => {
      console.error("MSAL error:", err);
      setLoading(false);
    });
  }, []);

  // Refresh user data from backend on load (picks up role changes for already-signed-in users)
  useEffect(() => {
    async function refreshUser() {
      const saved = localStorage.getItem("tasksheet_user");
      if (!saved) return;
      const cachedUser = JSON.parse(saved);
      try {
        const res = await fetch(`${API_BASE}/employees`);
        if (res.ok) {
          const employees = await res.json();
          const updated = employees.find((e: any) => e.email === cachedUser.email);
          if (updated) {
            localStorage.setItem("tasksheet_user", JSON.stringify(updated));
            setUser(updated);
          }
        }
      } catch (err) {
        console.error("Failed to refresh user data:", err);
      }
    }
    refreshUser();
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
      <Route path="/" element={<Dashboard userEmail={user.email} userRole={user.role} onLogout={handleLogout} />} />
      <Route path="/edit" element={<WorkingHoursEditor userEmail={user.email} />} />
      <Route path="/submit" element={<TaskSubmission userEmail={user.email} userRole={user.role} />} />
      {user.role === "admin" && (
        <Route path="/projects" element={<Projects userEmail={user.email} />} />
      )}
    </Routes>
  )
}

export default App
