// PWA install affordance (pwa spec): expose whether the browser currently
// offers installation and, if so, trigger its native prompt. Chromium fires
// `beforeinstallprompt`; other browsers (e.g. iOS) never do, so `canInstall`
// stays false and no affordance is shown.

import { useCallback, useEffect, useState } from "react";

// `BeforeInstallPromptEvent` is not in the DOM lib; declare the minimal shape
// the hook relies on.
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt: () => Promise<void>;
}

export interface InstallPromptState {
  canInstall: boolean;
  promptInstall: () => Promise<void>;
}

export function useInstallPrompt(): InstallPromptState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      // Suppress the default mini-infobar and keep the event so the app can
      // trigger the prompt from its own affordance.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    // The event can only be used once; drop it so the affordance disappears.
    setDeferred(null);
  }, [deferred]);

  return { canInstall: deferred !== null, promptInstall };
}
