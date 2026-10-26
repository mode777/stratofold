// Cast (web-ui spec, add-chromecast-playback): the official Web Sender
// SDK loaded lazily for video playback, a root provider that owns the
// Cast session across navigation, and the media handoff. A signed-in
// user casts through a freshly minted 24-hour /s/<token> link; an
// anonymous public visitor uses the plain /files URL. The local player
// keeps the cookie-authenticated /files source.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { filesUrl, mintFileLink } from "./filesApi";
import { useSession } from "./session";

export type CastStatus = "idle" | "connecting" | "connected" | "casting" | "failed";
export type CastFailure = "no-device" | "mint" | "load" | "unsupported";

export type CastRequest = {
  vdirId: string;
  path: string;
  title: string;
  contentType: string;
};

type CastSession = {
  loadMedia(request: unknown): Promise<unknown>;
  getCastDevice(): { friendlyName?: string } | null;
  endSession(stop: boolean): void;
};

type CastContext = {
  setOptions(options: unknown): void;
  requestSession(): Promise<unknown>;
  getCurrentSession(): CastSession | null;
  addEventListener(type: string, listener: (event: { sessionState: string }) => void): void;
  removeEventListener(type: string, listener: (event: { sessionState: string }) => void): void;
};

type RemotePlayer = { isConnected: boolean };
type RemotePlayerController = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

export type CastSdk = {
  framework: {
    CastContext: { getInstance(): CastContext };
    CastContextEventType: { SESSION_STATE_CHANGED: string };
    SessionState: { SESSION_STARTED: string; SESSION_RESUMED: string; SESSION_ENDED: string };
    RemotePlayer: new () => RemotePlayer;
    RemotePlayerController: new (player: RemotePlayer) => RemotePlayerController;
    RemotePlayerEventType: { IS_CONNECTED_CHANGED: string };
  };
  chrome: {
    cast: {
      AutoJoinPolicy: { ORIGIN_SCOPED: string };
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: string;
        MediaInfo: new (url: string, contentType: string) => { metadata?: { title?: string } };
        GenericMediaMetadata: new () => { title?: string };
        LoadRequest: new (media: unknown) => unknown;
      };
    };
  };
};

declare global {
  interface Window {
    cast?: { framework?: CastSdk["framework"] };
    chrome?: { cast?: CastSdk["chrome"]["cast"] };
    __onGCastApiAvailable?: (available: boolean) => void;
  }
}

const SDK_URL = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
const SDK_TIMEOUT_MS = 8000;

let sdkPromise: Promise<CastSdk | null> | null = null;

function existingSdk(): CastSdk | null {
  const framework = window.cast?.framework;
  const castApi = window.chrome?.cast;
  if (!framework || !castApi) return null;
  return { framework, chrome: { cast: castApi } };
}

function environmentSupportsCast(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.isSecureContext) return false;
  const ua = navigator.userAgent;
  // The Web Sender SDK is Chromium-only; iOS Chrome (CriOS) is WebKit.
  return /Chrome|Chromium|Edg/.test(ua) && !/CriOS|FxiOS/.test(ua);
}

// loadCastSdk injects the Google-hosted sender script once. A
// pre-installed SDK (tests, embedded stubs) short-circuits without a
// network request.
export function loadCastSdk(): Promise<CastSdk | null> {
  if (sdkPromise) return sdkPromise;
  const existing = existingSdk();
  if (existing) {
    sdkPromise = Promise.resolve(existing);
    return sdkPromise;
  }
  if (!environmentSupportsCast()) {
    sdkPromise = Promise.resolve(null);
    return sdkPromise;
  }
  sdkPromise = new Promise<CastSdk | null>((resolve) => {
    let settled = false;
    const finish = (sdk: CastSdk | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(sdk);
    };
    const timer = window.setTimeout(() => finish(null), SDK_TIMEOUT_MS);
    window.__onGCastApiAvailable = (available) => {
      finish(available ? existingSdk() : null);
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => finish(null);
    document.head.appendChild(script);
  });
  return sdkPromise;
}

type CastContextValue = {
  available: boolean;
  status: CastStatus;
  deviceName: string;
  failure: CastFailure | null;
  initialize: () => Promise<boolean>;
  cast: (request: CastRequest) => Promise<boolean>;
  stop: () => void;
};

const CastContextState = createContext<CastContextValue | null>(null);

export function CastProvider({
  children,
  loadSdk = loadCastSdk,
}: {
  children: ReactNode;
  loadSdk?: () => Promise<CastSdk | null>;
}) {
  const { state: sessionState } = useSession();
  const [sdk, setSdk] = useState<CastSdk | null>(null);
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<CastStatus>("idle");
  const [deviceName, setDeviceName] = useState("");
  const [failure, setFailure] = useState<CastFailure | null>(null);
  const initRef = useRef<Promise<CastSdk | null> | null>(null);

  const initialize = useCallback(async () => {
    if (!initRef.current) {
      initRef.current = loadSdk().then((loaded) => {
        if (loaded) {
          setSdk(loaded);
          setAvailable(true);
        } else {
          setAvailable(false);
        }
        return loaded;
      });
    }
    return (await initRef.current) !== null;
  }, [loadSdk]);

  useEffect(() => {
    if (!sdk) return;
    const context = sdk.framework.CastContext.getInstance();
    context.setOptions({
      receiverApplicationId: sdk.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: sdk.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });

    const onSession = (event: { sessionState: string }) => {
      if (
        event.sessionState === sdk.framework.SessionState.SESSION_STARTED ||
        event.sessionState === sdk.framework.SessionState.SESSION_RESUMED
      ) {
        const session = context.getCurrentSession();
        setDeviceName(session?.getCastDevice()?.friendlyName ?? "Cast device");
        setStatus((current) => (current === "casting" ? current : "connected"));
      } else if (event.sessionState === sdk.framework.SessionState.SESSION_ENDED) {
        setStatus("idle");
        setDeviceName("");
      }
    };
    context.addEventListener(sdk.framework.CastContextEventType.SESSION_STATE_CHANGED, onSession);

    const player = new sdk.framework.RemotePlayer();
    const controller = new sdk.framework.RemotePlayerController(player);
    const onConnected = () => {
      if (!player.isConnected) {
        setStatus("idle");
        setDeviceName("");
      }
    };
    controller.addEventListener(sdk.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED, onConnected);

    return () => {
      context.removeEventListener(sdk.framework.CastContextEventType.SESSION_STATE_CHANGED, onSession);
      controller.removeEventListener(
        sdk.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
        onConnected,
      );
    };
  }, [sdk]);

  const cast = useCallback(
    async (request: CastRequest) => {
      if (!sdk) {
        setFailure("unsupported");
        setStatus("failed");
        return false;
      }
      setFailure(null);
      setStatus("connecting");
      const context = sdk.framework.CastContext.getInstance();
      try {
        await context.requestSession();
      } catch {
        setFailure("no-device");
        setStatus("idle");
        return false;
      }
      const session = context.getCurrentSession();
      if (!session) {
        setFailure("no-device");
        setStatus("idle");
        return false;
      }
      setDeviceName(session.getCastDevice()?.friendlyName ?? "Cast device");
      setStatus("connected");

      let url: string;
      try {
        if (sessionState === "authenticated") {
          const link = await mintFileLink(request.vdirId, request.path);
          url = `${window.location.origin}${link.url}`;
        } else {
          url = `${window.location.origin}${filesUrl(request.vdirId, request.path)}`;
        }
      } catch {
        setFailure("mint");
        setStatus("failed");
        return false;
      }

      try {
        const media = new sdk.chrome.cast.media.MediaInfo(url, request.contentType);
        media.metadata = new sdk.chrome.cast.media.GenericMediaMetadata();
        media.metadata.title = request.title;
        await session.loadMedia(new sdk.chrome.cast.media.LoadRequest(media));
        setStatus("casting");
        return true;
      } catch {
        setFailure("load");
        setStatus("failed");
        return false;
      }
    },
    [sdk, sessionState],
  );

  const stop = useCallback(() => {
    if (sdk) {
      sdk.framework.CastContext.getInstance().getCurrentSession()?.endSession(true);
    }
    setStatus("idle");
    setDeviceName("");
    setFailure(null);
  }, [sdk]);

  const value = useMemo<CastContextValue>(
    () => ({ available, status, deviceName, failure, initialize, cast, stop }),
    [available, status, deviceName, failure, initialize, cast, stop],
  );

  return <CastContextState.Provider value={value}>{children}</CastContextState.Provider>;
}

export function useCast(): CastContextValue {
  const value = useContext(CastContextState);
  if (!value) throw new Error("useCast outside CastProvider");
  return value;
}
