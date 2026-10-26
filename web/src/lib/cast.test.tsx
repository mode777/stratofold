import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CastProvider, loadCastSdk, useCast, type CastSdk } from "./cast";
import { CastIndicator } from "../components/CastIndicator";

const sessionState = vi.hoisted(() => ({ state: "authenticated" as string }));

vi.mock("./session", () => ({
  useSession: () => ({
    state: sessionState.state,
    userId: "u1",
    userEmail: "owner@stratofold.test",
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const mintFileLink = vi.hoisted(() =>
  vi.fn(async () => ({ url: "/s/tok", expiresAt: "2026-10-27T19:00:00Z" })),
);

vi.mock("./filesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./filesApi")>();
  return { ...actual, mintFileLink };
});

type FakeSdk = {
  sdk: CastSdk;
  loads: Array<{ media: { url: string; contentType: string; metadata?: { title?: string } } }>;
  emitSession(state: string): void;
  emitConnected(connected: boolean): void;
  requestSession: ReturnType<typeof vi.fn>;
  endSession: ReturnType<typeof vi.fn>;
};

function fakeSdk(loadFails = false, requestFails = false): FakeSdk {
  const loads: FakeSdk["loads"] = [];
  const sessionListeners: Array<(event: { sessionState: string }) => void> = [];
  const connectionListeners: Array<() => void> = [];
  const session = {
    loadMedia: vi.fn(async (request: unknown) => {
      if (loadFails) throw new Error("load rejected");
      loads.push(request as FakeSdk["loads"][number]);
    }),
    getCastDevice: () => ({ friendlyName: "Living Room TV" }),
    endSession: vi.fn(() => {
      for (const listener of sessionListeners) listener({ sessionState: "SESSION_ENDED" });
    }),
  };
  const context = {
    setOptions: vi.fn(),
    requestSession: vi.fn(async () => {
      if (requestFails) throw new Error("cancelled");
      for (const listener of sessionListeners) listener({ sessionState: "SESSION_STARTED" });
    }),
    getCurrentSession: () => session,
    addEventListener: (_type: string, listener: (event: { sessionState: string }) => void) =>
      void sessionListeners.push(listener),
    removeEventListener: vi.fn(),
  };
  class MediaInfo {
    metadata?: { title?: string };
    constructor(
      public url: string,
      public contentType: string,
    ) {}
  }
  class GenericMediaMetadata {
    title?: string;
  }
  class LoadRequest {
    constructor(public media: MediaInfo) {}
  }
  let providerPlayer: { isConnected: boolean } | null = null;
  const sdk = {
    framework: {
      CastContext: { getInstance: () => context },
      CastContextEventType: { SESSION_STATE_CHANGED: "SESSION_STATE_CHANGED" },
      SessionState: {
        SESSION_STARTED: "SESSION_STARTED",
        SESSION_RESUMED: "SESSION_RESUMED",
        SESSION_ENDED: "SESSION_ENDED",
      },
      RemotePlayer: class {
        isConnected = true;
      },
      RemotePlayerController: class {
        constructor(private player: { isConnected: boolean }) {}
        addEventListener(_type: string, listener: () => void) {
          providerPlayer = this.player;
          connectionListeners.push(listener);
        }
        removeEventListener() {}
      },
      RemotePlayerEventType: { IS_CONNECTED_CHANGED: "IS_CONNECTED_CHANGED" },
    },
    chrome: {
      cast: {
        AutoJoinPolicy: { ORIGIN_SCOPED: "ORIGIN_SCOPED" },
        media: {
          DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845",
          MediaInfo,
          GenericMediaMetadata,
          LoadRequest,
        },
      },
    },
  } as unknown as CastSdk;
  return {
    sdk,
    loads,
    emitSession: (state) => {
      for (const listener of sessionListeners) listener({ sessionState: state });
    },
    emitConnected: (next) => {
      if (providerPlayer) providerPlayer.isConnected = next;
      for (const listener of connectionListeners) listener();
    },
    requestSession: context.requestSession,
    endSession: session.endSession,
  };
}

function Harness() {
  const cast = useCast();
  return (
    <div>
      <button type="button" data-testid="init" onClick={() => void cast.initialize()}>
        init
      </button>
      <button
        type="button"
        data-testid="cast"
        disabled={!cast.available}
        onClick={() =>
          void cast.cast({
            vdirId: "v1",
            path: "movie.mp4",
            title: "movie.mp4",
            contentType: "video/mp4",
          })
        }
      >
        cast
      </button>
      <button type="button" data-testid="stop" onClick={cast.stop}>
        stop
      </button>
      <CastIndicator />
      <span data-testid="status">{cast.status}</span>
      <span data-testid="device">{cast.deviceName}</span>
      {cast.failure && <span data-testid="failure">{cast.failure}</span>}
    </div>
  );
}

function renderCast(fake: FakeSdk) {
  return render(
    <CastProvider loadSdk={async () => fake.sdk}>
      <Harness />
    </CastProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  sessionState.state = "authenticated";
});

describe("loadCastSdk", () => {
  it("uses an already-present SDK without injecting the gstatic script", async () => {
    const fake = fakeSdk();
    (window as unknown as { cast?: unknown }).cast = { framework: fake.sdk.framework };
    (window as unknown as { chrome?: unknown }).chrome = { cast: fake.sdk.chrome.cast };

    await expect(loadCastSdk()).resolves.toBeTruthy();
    expect(document.querySelector('script[src*="cast_sender"]')).toBeNull();

    delete (window as unknown as { cast?: unknown }).cast;
    delete (window as unknown as { chrome?: unknown }).chrome;
  });
});

describe("CastProvider", () => {
  it("initializes lazily, casts a minted link, and exposes the indicator/stop", async () => {
    const fake = fakeSdk();
    renderCast(fake);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("init"));
    await waitFor(() => expect(screen.getByTestId("cast")).toBeEnabled());

    await user.click(screen.getByTestId("cast"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("casting"));
    expect(screen.getByTestId("device")).toHaveTextContent("Living Room TV");
    expect(screen.getByTestId("cast-indicator")).toHaveTextContent("Casting to Living Room TV");
    expect(mintFileLink).toHaveBeenCalledWith("v1", "movie.mp4");
    expect(fake.loads[0].media.url).toBe(`${window.location.origin}/s/tok`);

    await user.click(screen.getByTestId("cast-stop"));
    expect(fake.endSession).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId("cast-indicator")).not.toBeInTheDocument();
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
  });

  it("clears the session on a device-side disconnect", async () => {
    const fake = fakeSdk();
    renderCast(fake);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("init"));
    await waitFor(() => expect(screen.getByTestId("cast")).toBeEnabled());
    await user.click(screen.getByTestId("cast"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("casting"));

    fake.emitConnected(false);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("idle"));
    expect(screen.queryByTestId("cast-indicator")).not.toBeInTheDocument();
  });

  it("clears the session on SESSION_ENDED", async () => {
    const fake = fakeSdk();
    renderCast(fake);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("init"));
    await waitFor(() => expect(screen.getByTestId("cast")).toBeEnabled());
    await user.click(screen.getByTestId("cast"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("casting"));

    fake.emitSession("SESSION_ENDED");
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("idle"));
    expect(screen.getByTestId("device")).toHaveTextContent("");
  });

  it("uses the plain /files URL for an anonymous public cast", async () => {
    sessionState.state = "anonymous";
    const fake = fakeSdk();
    renderCast(fake);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("init"));
    await waitFor(() => expect(screen.getByTestId("cast")).toBeEnabled());
    await user.click(screen.getByTestId("cast"));
    await waitFor(() => expect(fake.loads).toHaveLength(1));

    expect(mintFileLink).not.toHaveBeenCalled();
    expect(fake.loads[0].media.url).toBe(`${window.location.origin}/files/v1/movie.mp4`);
  });

  it("reports a cancelled/no-device picker without claiming success", async () => {
    const fake = fakeSdk(false, true);
    renderCast(fake);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("init"));
    await waitFor(() => expect(screen.getByTestId("cast")).toBeEnabled());
    await user.click(screen.getByTestId("cast"));

    await waitFor(() => expect(screen.getByTestId("failure")).toHaveTextContent("no-device"));
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
    expect(screen.queryByTestId("cast-indicator")).not.toBeInTheDocument();
  });

  it("reports a receiver load failure", async () => {
    const fake = fakeSdk(true);
    renderCast(fake);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("init"));
    await waitFor(() => expect(screen.getByTestId("cast")).toBeEnabled());
    await user.click(screen.getByTestId("cast"));

    await waitFor(() => expect(screen.getByTestId("failure")).toHaveTextContent("load"));
    expect(fake.loads).toHaveLength(0);
  });
});
