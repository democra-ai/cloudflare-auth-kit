import React from "react";
import ReactDOM from "react-dom/client";
import { AuthUIProvider, AuthView, PasskeysCard } from "@daveyplate/better-auth-ui";
import { Toaster } from "sonner";
import { authClient } from "./auth-client";
import "./index.css";

import type { SocialProvider } from "better-auth/social-providers";

// The Worker tells us which social providers have credentials configured and
// whether public password sign-up is open, so the UI always matches the server.
type Health = { providers?: Record<string, boolean>; signup?: boolean; passkey?: boolean };
const health = await fetch("/providers")
  .then((r) => r.json() as Promise<Health>)
  .catch(() => ({}) as Health);

const providers = (["google", "apple", "github", "microsoft"] as SocialProvider[]).filter(
  (p) => health.providers?.[p],
);
const signUpOpen = health.signup === true;

const params = new URLSearchParams(window.location.search);
// better-auth-ui reads ?redirectTo= natively; keep ?redirect_to= working too.
const redirectTo = params.get("redirectTo") || params.get("redirect_to") || "/";

// /login (legacy entry) renders the sign-in view; /auth/* picks the view from the path.
const pathname = window.location.pathname === "/login" ? "/auth/sign-in" : window.location.pathname;

// Views that must render even when a session exists (completing a flow / signing out).
const FLOW_VIEWS = new Set([
  "sign-out",
  "callback",
  "reset-password",
  "forgot-password",
  "email-verification",
  "email-otp",
  "magic-link",
  "two-factor",
  "recover-account",
  "accept-invitation",
]);
const isEntryView = !FLOW_VIEWS.has(pathname.split("/").pop() ?? "");

function AccountCard() {
  const { data: session } = authClient.useSession();
  const user = session?.user as
    | { name?: string; email?: string; image?: string | null; role?: string }
    | undefined;
  if (!user) return null;
  return (
    <div className="bg-card text-card-foreground w-full max-w-sm rounded-xl border shadow-sm">
      <div className="flex items-center gap-3 p-6 pb-4">
        {user.image ? (
          <img src={user.image} alt="" className="size-11 rounded-full" />
        ) : (
          <div className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-full text-base font-semibold">
            {(user.name || user.email || "?").slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate font-semibold">{user.name || user.email}</div>
          <div className="text-muted-foreground truncate text-sm">{user.email}</div>
        </div>
        <span className="bg-accent text-accent-foreground ml-auto rounded-md px-2 py-0.5 text-xs font-medium">
          {user.role || "user"}
        </span>
      </div>
      <div className="grid gap-2 p-6 pt-0">
        <a
          href={redirectTo}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md text-sm font-medium transition-colors"
        >
          Continue
        </a>
        <button
          onClick={() => authClient.signOut().then(() => window.location.replace("/auth/sign-in"))}
          className="border-input hover:bg-accent hover:text-accent-foreground inline-flex h-9 items-center justify-center rounded-md border bg-transparent text-sm font-medium transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function Gate() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return null;
  // Signed-in visitors on an entry view (sign-in/sign-up) see their account — plus
  // passkey management, so a password sign-in can enroll a passkey for next time.
  // Flow views (sign-out, callback, ...) still render.
  if (session && isEntryView)
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        <AccountCard />
        {health.passkey === true && <PasskeysCard />}
      </div>
    );
  return <AuthView pathname={pathname} />;
}

function App() {
  return (
    <AuthUIProvider
      authClient={authClient}
      social={providers.length ? { providers } : undefined}
      signUp={signUpOpen}
      passkey={health.passkey === true}
      credentials={{ forgotPassword: false }}
      redirectTo={redirectTo}
    >
      <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-4 md:p-6">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary size-3 rounded-full" aria-hidden />
          <span className="text-muted-foreground text-sm font-medium tracking-wide">
            Cloudflare Auth Kit
          </span>
        </div>
        <Gate />
      </main>
      <Toaster richColors position="top-center" />
    </AuthUIProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
