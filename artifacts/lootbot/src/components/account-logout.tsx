import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { teacherApi, TeacherApiError } from "../lib/teacher-api";

const logoutEvent = "lootbot-account-logout";
async function completeLogout(client: QueryClient) {
  try {
    await client.cancelQueries();
  } catch {
    /* Navigation still clears client memory. */
  }
  client.clear();
  const event = { type: "logout", nonce: crypto.randomUUID() };
  try {
    localStorage.setItem(logoutEvent, JSON.stringify(event));
  } catch {
    /* BroadcastChannel remains available. */
  }
  try {
    const channel = new BroadcastChannel(logoutEvent);
    channel.postMessage(event);
    channel.close();
  } catch {
    /* Storage events remain available. */
  }
  window.location.replace("/login");
}

/** No account identifiers or credentials are broadcast; the server revokes the session first. */
export function AccountLogoutSync() {
  const client = useQueryClient();
  useEffect(() => {
    let leaving = false;
    const leave = () => {
      if (leaving) return;
      leaving = true;
      client.clear();
      window.location.replace("/login");
    };
    const storage = (event: StorageEvent) => {
      if (event.key === logoutEvent && event.newValue) leave();
    };
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(logoutEvent);
      channel.onmessage = (event) => {
        if (event.data?.type === "logout") leave();
      };
    } catch {
      /* Storage fallback. */
    }
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("storage", storage);
      channel?.close();
    };
  }, [client]);
  return null;
}

export function AccountLogoutButton({
  locale = "ar",
  className = "",
  disabled = false,
}: {
  locale?: "ar" | "en";
  className?: string;
  disabled?: boolean;
}) {
  const client = useQueryClient(),
    inFlight = useRef(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const ar = locale === "ar";
  async function signOut() {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await teacherApi<{ success: boolean }>(
        "/auth/logout",
        "POST",
        {},
      );
      if (response.success !== true)
        throw Error(
          ar
            ? "تعذر تأكيد تسجيل الخروج. حاول مجددًا."
            : "Could not confirm sign out. Try again.",
        );
      await completeLogout(client);
    } catch (error) {
      if (error instanceof TeacherApiError && error.status === 401) {
        await completeLogout(client);
        return;
      }
      setError(
        error instanceof TeacherApiError
          ? error.message
          : ar
            ? "تعذر تسجيل الخروج. حاول مجددًا."
            : "Could not sign out. Try again.",
      );
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className={"account-logout " + className}>
      <button
        type="button"
        data-testid="button-account-logout"
        disabled={busy || disabled}
        aria-busy={busy}
        onClick={() => void signOut()}
      >
        <LogOut size={16} aria-hidden="true" />
        <span>
          {busy
            ? ar
              ? "جار تسجيل الخروج…"
              : "Signing out…"
            : ar
              ? "تسجيل الخروج"
              : "Sign out"}
        </span>
      </button>
      {error && (
        <span className="account-logout-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
