import { useMsal } from "@azure/msal-react";
import { loginRequest } from "../authConfig";

interface LoginProps {
  onLogin: (user: { id: number; name: string; email: string }) => void;
}

export default function Login({ onLogin: _onLogin }: LoginProps) {
  const { instance } = useMsal();

  function handleMicrosoftLogin() {
    instance.loginRedirect(loginRequest);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1c2e] via-[#16213e] to-[#0f3460] flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 p-8 w-full max-w-md shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Task Sheet</h1>
          <p className="text-white/60 text-sm">Sign in with your Botangelos account</p>
        </div>

        <button
          onClick={handleMicrosoftLogin}
          className="w-full px-4 py-3 bg-white/10 border border-white/30 text-white rounded-lg hover:bg-white/20 font-semibold transition-all flex items-center justify-center gap-3"
        >
          <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
            <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
            <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
          </svg>
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
}
