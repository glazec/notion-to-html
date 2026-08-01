"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth/client";

export function AuthButton({
  userEmail,
  prominent = false,
}: {
  userEmail: string | null;
  prominent?: boolean;
}) {
  const [pending, setPending] = useState(false);

  if (userEmail) {
    return (
      <button
        className="account-button"
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          await authClient.signOut();
          window.location.assign("/");
        }}
      >
        <span>{userEmail}</span>
        <LogOut size={14} aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      className={prominent ? "google-button prominent" : "google-button"}
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const { error } = await authClient.signIn.social({
          provider: "google",
          callbackURL: `${window.location.origin}/auth/callback`,
          errorCallbackURL: `${window.location.origin}/?notice=auth-error`,
        });
        if (error) setPending(false);
      }}
    >
      <span className="google-mark" aria-hidden="true">G</span>
      {pending ? "Connecting…" : "Continue with Google"}
    </button>
  );
}
