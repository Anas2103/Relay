import { useCallback, useEffect, useState } from "react";
import type { Me } from "../shared/types";
import { AuthScreen } from "./components/AuthScreen";
import { ChatLayout } from "./components/ChatLayout";
import { Logo } from "./components/ui";
import { api, UNAUTHORIZED_EVENT } from "./lib/api";
import { applyAppearance } from "./lib/theme";

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const updateMe = useCallback((next: Me) => {
    setMe(next);
    applyAppearance(next.settings, true);
  }, []);

  useEffect(() => {
    api
      .me()
      .then((r) => {
        setMe(r.user);
        applyAppearance(r.user.settings);
      })
      .catch(() => setMe(null))
      .finally(() => setLoading(false));

    const onUnauthorized = () => setMe(null);
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

  if (!me) return <AuthScreen onAuthed={updateMe} />;

  return (
    <ChatLayout
      me={me}
      onMeUpdated={updateMe}
      onLogout={async () => {
        await api.logout().catch(() => {});
        setMe(null);
      }}
    />
  );
}
