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
- **Public name** — one optional, globally unique, lowercase name per
  vdir (`my-public-folder`). While the vdir is public it is also
  available at `/apps/my-public-folder`; the name is reserved while the
  vdir is private ([public-urls spec](../openspec/specs/public-urls/spec.md)).

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
by anyone with its link. On the sharing screen you can also claim a
**public name** (lowercase letters, digits, and hyphens, 2–63 characters)
for a memorable `/apps/<name>` address; the name is global to the
instance and only one vdir can hold it
([public-urls spec](../openspec/specs/public-urls/spec.md)).

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
- To act on several entries at once, owners and editors can choose
  **Select** in the folder header. Checkboxes appear in both list and
  grid view; tapping an entry selects it instead of opening it, and the
  usual long-press/ellipsis menu is paused while selecting. **Select
  all** / **Deselect all** cover the current listing, the count updates
  as you toggle entries, and **Done** returns to normal browsing. The
  selection belongs to the directory you are in and is cleared when you
  leave it.
- With entries selected, **Move** opens the same destination picker
  (titled with the number of items) and moves every selected entry into
  the chosen folder; it will not accept the current directory, a
  selected folder, or a folder inside one as the destination. **Delete**
  asks for confirmation, names the number of entries, and warns that
  selected folders are removed with their contents. If one entry fails,
  the rest are still attempted: successful items are applied, failed
  items remain, and a dismissible notice names the failures with their
  error class. Each entry is still moved or deleted atomically; there is
  no separate server-side batch job.
- Instead of the picker you can **drag & drop**: drop files anywhere on
  the listing — the empty-directory state included — to upload them into
  the directory you are browsing (the listing highlights while you
  drag), or drop whole folders from your file manager. A dropped folder
  keeps its name and structure: every file inside uploads at the same
  relative place, and empty folders are created too, so an existing
  folder tree lands on the SSH host ready to use. Dropped uploads join
  the same queue as the picker, and anything that cannot be read (for
  example a folder the browser refuses to enumerate) is named in a
  dismissible notice while the rest still uploads. Viewers and public
  visitors get no drop behavior.
- Owners and editors can **Extract** a `.zip` (context menu): it unpacks
  into a folder named after the archive, right beside it — `docs/photos.zip`
  becomes `docs/photos/`. The archive is read from the SSH host and each
  file is written back as it unpacks, so nothing is downloaded to your
  device and nothing is stored on the Stratofold host. A progress row
  appears on **Uploads** and the new folder shows up as soon as the
  unpack finishes; cancel any time before then. If a folder with that
  name already exists the app says so and suggests another name instead
  of merging. Entries that cannot be extracted safely are skipped and
  counted rather than failing the whole archive: Apple metadata
  (`__MACOSX/`, `._*`, `.DS_Store`, `Thumbs.db`) silently, and genuinely
  invalid entries — names that would write outside the folder, links,
  password-protected members, unreadable data — reported on the progress
  row with their names, so one bad entry never costs you the other
  thousands. An archive from which nothing at all could be extracted
  (for example a fully password-protected one), or one over the size and
  entry limits, is still refused as a whole — nothing partial is ever
  published. See the
  [archive-extraction spec](../openspec/specs/archive-extraction/spec.md).

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

Select files in the folder header of any directory you may write to, or
drag files and folders onto its listing (see above); uploads go into an
in-app queue — one at a time, in the order you added them — that keeps
running while you navigate elsewhere
([upload-queue spec](../openspec/specs/upload-queue/spec.md)).

- The **Uploads** destination shows the queue; a floating indicator on
  other screens shows that something is in flight.
- Folder drops show up as **Creating folder** steps that run before the
  files they contain. Canceling or failing one also cancels or fails the
  files inside it that had not started yet, and retrying it brings them
  back — so one refused folder never produces a pile of separate errors.
- Each upload reports progress and can be **paused**, **canceled**, or,
  after a failure, **retried**. Failures that can't succeed (for example
  a permission rejection) are marked permanent and are not retried
  automatically.
- A canceled or failed upload restarts from the beginning; nothing is
  published partially — an upload appears in the folder only once it is
  fully on the SSH host. A file — or a dropped folder — that finishes
  while you are still browsing its directory appears in the listing
  without a reload.

## Sharing a vdir

On a vdir you own, **Settings → Vdirs → Sharing** lets you grant access
by the grantee's exact registered email, as `viewer` or `editor`
([sharing-access-control spec](../openspec/specs/sharing-access-control/spec.md)).

- You can change a share's role or delete it at any time; a removed
  share or changed role applies to the person's next request — no
  re-login needed on their side.
- While a vdir is public, the sharing screen offers its public link with
  a copy action: `/apps/<public-name>` when a name is registered,
  otherwise `/v/<vdir-id>`. The link carries no token: revoking public
  access is the vdir's public toggle, and un-publishing cuts anonymous
  access on the next request (the name stays reserved for re-publishing).
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

## Connecting an app (access tokens)

**Settings → Connected apps** lets you mint a bearer credential for a
script or third-party app that needs to read or write one vdir without
your sign-in cookie
([vdir-access-tokens spec](../openspec/specs/vdir-access-tokens/spec.md)).
Choose a vdir you own or one shared with you, give the token a name,
pick `viewer` (browse and download) or `editor` (also upload, rename,
move, and delete) where your role allows it, and optionally set an
expiry.

- The token is shown **once**, on the screen that creates it. Copy it
  then; the app needs it in an `Authorization: Bearer …` header.
- The same panel also shows a **connection string** (`sfconn_v1_…`)
  that bundles the server address, this vdir, and the token. Apps using
  `@stratofold/client` can pass it to
  `StratofoldClient.fromConnectionString(...)`; if the instance address
  changes, supply a `baseUrl` override. It is a one-time secret like the
  token — copy it before dismissing the panel; it is never stored or
  shown again, and it is not a URL.
- A token is bound to that one user and vdir. It cannot be used on
  another vdir, and its role is capped by your current access: a viewer
  token stays read-only even for an owner, and an editor token stops
  writing if your share is downgraded.
- Removing your share, changing your role, deleting the vdir or user, or
  letting the token expire ends its access on the next request. An
  editor can mint an editor token, and a viewer can mint only a viewer
  token.
- Revoke a token from the same screen; it stops working immediately.
  **Last used** helps you spot stale credentials.
- A token is a bearer secret: anyone who has it can use it until it is
  revoked or expires. Do not put a token for private data in a public
  website's bundle, and serve the instance over HTTPS. There is no
  per-visitor consent flow yet — a multi-user website should not ask
  users to paste a token into the site.

## Public browsing

Anyone can open a public vdir's link without an account and browse,
preview, and download — the same read-only experience a signed-in
viewer gets, with no write or management controls and no app
destinations. If the vdir stops being public, the visitor's next action
says so explicitly.

- **Pretty public URLs.** When the owner registers a public name, the
  folder is available at `/apps/<name>` in addition to `/v/<vdir-id>`.
  Folder, breadcrumb, preview, and back navigation stay under the pretty
  URL. Names are global across the instance; a name already taken by
  another vdir is rejected with an "already taken" message.
- **Reserved while private.** Registering a name does not publish the
  vdir. The `/apps/<name>` URL is a `404` while the vdir is private;
  un-publishing keeps the name reserved, and re-publishing restores the
  URL. Releasing a name or deleting the vdir frees it immediately, so a
  later owner can claim it and old links can point at different content;
  register deliberately and keep the vdir public for as long as the link
  matters.
- **Direct file links and static entry points.** `/apps/<name>/docs/report.pdf`
  streams the file with the same Range, cache-validator, and resume
  behavior as `/files`. A directory URL (with a trailing slash) serves
  its `index.html` when one exists, so a published app or site works at
  `/apps/<name>/` and `/apps/<name>/docs/`; a directory without an index
  shows the read-only browse view instead. A directory without the
  trailing slash redirects to the slashed form. The index convention is
  `index.html` only.
- **The `view` name is reserved at the folder root.** The in-app preview
  uses `/apps/<name>/view/…`, so a remote folder literally named `view`
  at the vdir root is reachable only through
  `/files/<vdir-id>/view/…`; a nested `docs/view/…` folder works
  normally.

Every file's context menu also offers **Copy public link**, which puts
that file's absolute direct URL on the clipboard — the `/apps/<name>/…`
form when a public name is registered, otherwise `/files/<vdir-id>/…`.
It carries no token: it downloads the file only while the vdir is
public, exactly like the vdir's browse link.

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
and [`pwa`](../openspec/specs/pwa/spec.md); access-token behavior is
pinned by the `vdir-access-tokens` capability and
[ADR 0012](decisions/0012-vdir-access-tokens.md). If this guide and a spec
ever disagree, the spec wins — and this guide needs fixing.
