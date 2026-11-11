import { useEffect, useState } from "react";
import type { User } from "../shared/types";
import { AuthScreen } from "./components/AuthScreen";
import { ChatLayout } from "./components/ChatLayout";
import { Logo } from "./components/ui";
import { api, UNAUTHORIZED_EVENT } from "./lib/api";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));

    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-pulse">
          <Logo size={48} />
        </div>
      </div>
    );
  }

  if (!user) return <AuthScreen onAuthed={setUser} />;

  return (
    <ChatLayout
      me={user}
      onUserUpdated={setUser}
      onLogout={async () => {
        await api.logout().catch(() => {});
        setUser(null);
      }}
    />
  );
}
