# Using Stratofold

The day-to-day guide to the Stratofold web app. For running your own
instance, see [Hosting Stratofold](hosting.md).

Stratofold is a cloud file manager: your files live on SSH hosts you
connect, and Stratofold makes them browsable, shareable, and streamable
through the web — a Google Drive / Dropbox-style app on top of SSH/SFTP.
Files are streamed directly between the browser and the SSH source; the
server never caches them in RAM or on disk, so multi-gigabyte transfers
are ordinary.

## Accounts and sign-in

- Accounts are created by your instance's admin (there is no
  self-signup). If you run the instance, the
  [hosting guide](hosting.md#first-time-setup) shows how to create the
  admin and regular users.
- Sign in at the app root with your email and password. The session
  survives closing the browser and ends via logout
  ([web-ui spec](../openspec/specs/web-ui/spec.md)).
- Signed in, you get three destinations — Files, Uploads, Settings — as
  a bottom tab bar on phones and a sidebar on larger screens
  ([ADR 0008](decisions/0008-ios-mobile-spa-shell.md) for the shell).

## Concepts

- **Connection** — an SSH host you can reach: host, port, username, and
  a password or private key. Connections belong to the user who created
  them; nobody else can see them.
- **Virtual directory (vdir)** — a folder on an SSH host exposed as one
  browsable root, bound to one of your connections. Access to a vdir is
  decided by the server before it ever contacts the SSH host.
- **Share** — you can grant another registered user (by exact email)
  access to one of your vdirs with the role `viewer` (browse and
  download) or `editor` (browse, download, and change files).
- **Public vdir** — a vdir marked public can be browsed and downloaded
  by anyone with its link, no account needed. Public access is strictly
  read-only: uploads and changes always require a signed-in owner or
  editor ([sharing-access-control spec](../openspec/specs/sharing-access-control/spec.md)).

## Connecting an SSH host

Under **Settings → Connections**, add a connection: a label, the host
and port, your username, and either the password or a private key
([web-ui spec](../openspec/specs/web-ui/spec.md): *"Connections are
manageable in the UI"*).

- **Host key**: you may pin a fingerprint of the host key. If you leave
  it empty, the first successful connection pins the key automatically
  (trust on first use) and it is verified on every later connection
  ([ADR 0007](decisions/0007-optional-host-key-tofu.md)).
- **Remote directory** (e.g. `/home/`) is the default starting folder
  offered when you create vdirs on this connection.
- Secrets are write-only: they are never shown back after saving, and
  saving an edit with an empty secret field keeps the stored secret.

## Creating a virtual directory

Under **Settings → Vdirs**, create a vdir: pick a name, bind one of
your own connections, and set the root path — it starts prefilled from
the connection's remote directory and can point anywhere on that host
the connection may read. Flip **public** if the vdir should be browsable
by anyone with its link.

## Browsing and files

Open a vdir from **Files** — your own vdirs under "My vdirs", vdirs
shared with you under "Shared with me"; public vdirs carry a marker
([web-ui spec](../openspec/specs/web-ui/spec.md)).

- Browse in a list or grid view, sort by name, size, or modification
  time, and navigate with breadcrumbs or the back control; very large
  directories (10,000+ entries) stay smooth.
- Tap a file to preview it (see below); **Download** is available in the
  context menu of every file — long-press (or the ellipsis, or keyboard)
  opens it — and inside the audio player and image viewer. Downloads
  stream straight from the SSH host and resume across connection drops.
- Owners and editors get new-folder and upload in the folder header plus
  **Rename**, **Move**, and **Delete** in the context menu (delete asks
  for confirmation first). Viewers see none of these — the UI only
  offers what your role on that vdir allows.

## Previews

What tapping a file opens depends on its kind
([web-ui spec](../openspec/specs/web-ui/spec.md)):

- **Audio** opens the in-app player (play/pause, scrubber, ±15s skip,
  and previous/next across the folder's tracks in listing order, wrapping
  at the ends). It plays straight through the folder — the next track
  starts when one finishes — and shows the folder's first image as cover
  art when there is one; it streams from the SSH host as you listen.
- **Images** open a fullscreen viewer: pinch or double-tap to zoom, pan
  while zoomed, swipe (or arrow keys) to move through the folder's
  images in listing order.
- **Video** opens the in-app video player: play/pause, a scrubber with
  elapsed/remaining time, volume/mute, fullscreen, and a download action.
  It streams the file straight from the SSH host and seeks via HTTP range
  requests. The context menu still offers **Open in new tab** when you
  want the browser's native player or a format the app cannot decode.
- **Everything else** opens a metadata card (name, size, modified) with
  a download action. An image the browser cannot decode (e.g. HEIC)
  falls back to that card too.

### Cast a video to a TV

In a Chromium browser over HTTPS, the video player's Cast button sends the
video to a Chromecast or Google Cast device using the **Default Media
Receiver** — no receiver app has to be installed:

- Pick a device; playback moves to the TV, local playback pauses, and a
  **Casting to <device>** indicator appears with a **Stop** action. The
  cast keeps running while you browse other screens.
- A signed-in user casts through a fresh 24-hour link for that one file.
  An anonymous visitor of a public vdir uses the plain public file URL.
  The link expires after 24 hours (or earlier if the creator loses
  access); un-publishing a public vdir does not cut a signed-in user's
  cast link.
- The browser must be Chromium (desktop, Android, or Edge) on a secure
  context, the Google Cast SDK script must be reachable, and the TV must
  be able to reach the Stratofold origin with a certificate it trusts.
  Casting is not available in Safari, Firefox, or iOS Chrome; AirPlay is
  not supported here.
- MP4 and WebM are the expected containers; MOV/OGV and some codecs may
  be rejected by the device with an explicit error. The app does not
  transcode.
- The browser's own "Cast" control on a video element does not work for
  a non-public vdir (it sends the cookie-protected `/files` URL); use the
  in-app Cast button.

## Uploads

Select files in the folder header of any directory you may write to;
uploads go into an in-app queue — one at a time, in the order you added
them — that keeps running while you navigate elsewhere
([upload-queue spec](../openspec/specs/upload-queue/spec.md)).

- The **Uploads** destination shows the queue; a floating indicator on
  other screens shows that something is in flight.
- Each upload reports progress and can be **paused**, **canceled**, or,
  after a failure, **retried**. Failures that can't succeed (for example
  a permission rejection) are marked permanent and are not retried
  automatically.
- A canceled or failed upload restarts from the beginning; nothing is
  published partially — an upload appears in the folder only once it is
  fully on the SSH host.

## Sharing a vdir

On a vdir you own, **Settings → Vdirs → Sharing** lets you grant access
by the grantee's exact registered email, as `viewer` or `editor`
([sharing-access-control spec](../openspec/specs/sharing-access-control/spec.md)).

- You can change a share's role or delete it at any time; a removed
  share or changed role applies to the person's next request — no
  re-login needed on their side.
- While a vdir is public, the sharing screen offers its plain link
  (`/v/<vdir-id>`) with a copy action. The link carries no token:
  revoking public access is the vdir's public toggle, and un-publishing
  cuts anonymous access on the next request.
- While a vdir is public, any file in it also offers **Copy public
  link** in the browse view's context menu — a direct link to that one
  file's download, no surrounding folder needed.
- On a vdir that is **not** public, a file's context menu offers
  **Copy 24-hour link** to anyone signed in who can read the vdir. It
  mints a temporary link that downloads only that one file without a
  sign-in and expires after 24 hours. Removing the creator's share (or
  deleting the vdir) ends their links on the next request; an owner's
  links keep working if the vdir is un-published. There is no link
  manager yet — mint a new link if you need to copy one again.

## Public browsing

Anyone can open a public vdir's link without an account and browse,
preview, and download — the same read-only experience a signed-in
viewer gets, with no write or management controls and no app
destinations. If the vdir stops being public, the visitor's next action
says so explicitly.

Every file's context menu also offers **Copy public link**, which puts
that file's absolute `/files` URL on the clipboard. It carries no
token: it downloads the file only while the vdir is public, exactly like
the vdir's browse link.

## Install as an app

Stratofold is an installable PWA: in a supporting browser, **Settings**
offers an install action when the browser can install it, and iOS
Safari's *Add to Home Screen* works from the share menu. The installed
app launches without browser UI. There is deliberately **no offline
mode** — without connectivity you get the app's normal failure states
([ADR 0009](decisions/0009-pwa-installable-no-offline.md)).

## Where behavior is pinned

The exact behaviors this guide describes are pinned by the capability
specs under [`openspec/specs/`](../openspec/specs/) — in particular
[`web-ui`](../openspec/specs/web-ui/spec.md),
[`filesystem-api`](../openspec/specs/filesystem-api/spec.md),
[`sharing-access-control`](../openspec/specs/sharing-access-control/spec.md),
and [`pwa`](../openspec/specs/pwa/spec.md). If this guide and a spec
ever disagree, the spec wins — and this guide needs fixing.
