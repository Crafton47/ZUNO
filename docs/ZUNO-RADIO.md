# ZUNO Radio and Vibe Check — 26 October 2026

## Summary

ZUNO Radio is a real YouTube playlist player with a server-side YouTube Data API v3 metadata layer, a searchable track browser, direct track selection, an expanded studio, a draggable floating player, a compact single-row mini bar, seek/volume/mute, Media Session controls, and background-tab playback. The existing Express/CommonJS, vanilla HTML/CSS/JavaScript and sql.js architecture is unchanged. No existing route, dashboard ID, Study Studio, chat, planner, reward or authentication feature was removed.

There are three layouts. The **floating player** is a 202 × 274 px glass card that keeps YouTube's required 200 × 200 px visible player, so music keeps playing while you drag it out of the way. The **mini bar** is deliberately small (330 × 66 px on desktop, 366 × 66 px on mobile) and is only used while paused, because YouTube requires a visible player during playback. The trade-off is documented under [Player layouts and YouTube compliance](#player-layouts-and-youtube-compliance).

## Root causes found and repaired

| Symptom | Root cause | Repair |
| --- | --- | --- |
| Music stopped when switching tabs | App-level `visibilitychange`/`blur`/`pagehide` handlers paused the player | Removed app-level visibility pauses. The player now continues when the page is hidden; only a real page unload stops it. |
| No track list or direct selection | Playlist import did not store individual entries and no Data API integration existed | Added the official Data API track pipeline, an additive cache and a searchable browser. |
| Unavailable entries were silently skipped or replaced | List order was treated as the same as YouTube player positions | Preserve Data API order and map by video ID against the IFrame `getPlaylist()` result; show unavailable/private/restricted rows instead of substituting. |
| Oversized mini player covered the dashboard | The previous mini layout embedded a 200 × 200 visible video, making it a 520 × 202 panel; simply shrinking a playing embed is not allowed | Added a draggable 202 × 274 floating card that keeps the legal 200 × 200 player, plus a 330 × 66 bar that is only used while paused. Drag position is persisted and clamped. |
| Restore/reload could lose the track, volume or autoplay state | Player state was not persisted coherently | Persist playlist, track, volume, mute and layout; restore without creating or autoplaying a player. |
| Seeking, volume and mute were unavailable | Only play/pause/next/previous commands were wired | Wired seek, volume, mute, retry, track selection and Media Session handlers. |
| Malformed metadata was reported as a deleted playlist | Metadata adapter collapsed parse/partial failures into `unavailable` | Distinguish temporary/configuration/quota failures from confirmed unavailability and keep saved details on failure. |

## Player layouts and YouTube compliance

All three layouts mount one fixed dock (`#radio-dock`) and one persistent iframe. Switching layout only changes CSS and position; it never destroys or remounts the player.

- **Expanded:** artwork row (88 × 50 thumbnail), title, artist, playlist information, previous/play/next, seek, volume, mute, the visible YouTube embed, searchable track list, playlist management, errors and collapsed diagnostics. **▼ Float player** or **▼ Mini player** collapses it, depending on whether audio is running. The embed renders at roughly 460 × 258 px on desktop, well above YouTube's minimum.
- **Floating (playing dock):** 202 × 274 px glass card. A 32 px header holds the drag grip (`⠿`), truncated title/artist (click to open the full player), Reset Position (`⌂`) and Expand (`⤢`). Below it is the actual 200 × 200 px YouTube embed, then a 38 px control row with Play/Pause, Next, elapsed time and **Mini (pauses)**, plus a 2 px lime progress line. The card is translucent with `backdrop-filter: blur(18px)`, a soft border/shadow and volt-lime accents.
- **Mini:** a compact single-row bar — 44 px artwork, truncated title and artist, Play/Pause, Next, Expand (`⤢`), and a 2 px progress line. Desktop is 330 × 66 px; mobile is `min(calc(100vw - 24px), 420px)` at 66 px high. This layout is only shown while paused; there is no video, track browser or diagnostics in the bar.

### The trade-off

YouTube's IFrame API requires an embedded player viewport of at least **200 × 200 px**, including its controls, and it must stay visible while playing. Hiding, transparentizing or shrinking a playing embed would separate audio from the player and violate YouTube's terms, so the app does not do it.

1. Pressing Play from the library, mood studio or mini bar opens the **floating** player first, so the video is visible whenever audio is running.
2. **▼ Float player** from the expanded studio keeps audio playing and switches to the draggable card. Collapsing while paused shows the mini bar instead.
3. The explicit **Mini (pauses)** button on the floating card pauses, then shows the 330 × 66 bar at the retained position.
4. Next from the bar opens the floating player before skipping. Expand (`⤢`) never autoplays.
5. Restoring after a reload shows the paused mini bar without creating or autoplaying a player. The saved floating position is reused when playback starts.

So the compact 66 px bar costs one extra click to resume, and it cannot host a playing embed. The floating player keeps continuous audio and is freely repositionable, but it is still a visible 202 × 274 window — that is the smallest compliant size, not a hidden audio stream.

### Placement, dragging and keyboard

- The expanded studio and the paused mini bar dock to the bottom-right: `right: 18px; bottom: 18px` (12 px plus safe-area on mobile).
- The floating card defaults to the bottom-right with an 18 px margin (12 px on mobile). Its position is stored as top-left pixels per account and is restored on the next visit.
- Drag from the header (the `⠿` grip, or the header background). Buttons in the header are excluded, so Reset and Expand never start a drag. Pointer Events with pointer capture support mouse, pen and touch; a 3 px threshold prevents accidental moves; the page disables text selection while dragging.
- The card is clamped to the viewport on load, on every layout change, on window resize and after every drop. On viewports ≤ 640 px it snaps to the nearest horizontal edge.
- Keyboard: focus the grip and use arrow keys to move 12 px (Shift + arrow: 40 px); **Home** resets to the bottom-right corner. A polite live region announces resets, edge snaps and keyboard coordinates.
- Dragging only changes `left`/`top`; it does not pause, seek, reload or recreate the iframe. Video controls, playlist interactions and text selection inside the 200 × 200 player are untouched.
- `prefers-reduced-motion` disables the entrance, spin, equalizer, progress and hover motion.
- Same-document dashboard navigation preserves both position and playback. `body.radio-active` reserves 96 px of bottom padding so the bar cannot cover composer inputs.

The YouTube iframe is never zero-sized or replaced by audio-only playback while playing. YouTube may insert ads or require a tap; the player reports those states rather than pretending playback succeeded.

## Background playback

The app no longer pauses on `visibilitychange`, `blur` or window focus changes. In Chrome/Edge, audio normally continues while another tab is active if the browser allows the embed to play. Background playback still depends on the browser, operating system power policy and YouTube's own constraints. A full-page refresh, a navigation that unloads the document, logout or closing the tab stops playback. There is no service worker, hidden iframe or media-download workaround.

Study Studio opens in a same-origin iframe when a playlist is loaded, so dashboard navigation keeps the single parent player. Direct `/study` navigation remains a normal document navigation and therefore stops audio.

## YouTube Data API usage

Only these official endpoints are called:

- `playlists.list` for real title, channel, artwork and item count.
- `playlistItems.list` with `pageToken` pagination for the ordered entries.
- `videos.list` in batches of up to 50 for titles, durations, privacy status and `embeddable`.

The API key is read only on the server from `YOUTUBE_API_KEY` (or the legacy `Youtube_API_KEY`). It is sent in the `X-Goog-Api-Key` header, not the URL. Requests use a 10-second timeout, reject redirects, and validate thumbnail hosts. No submitted URL is fetched, and no media is downloaded, proxied or re-hosted.

Track data is fetched lazily when a playlist is activated or browsed, not during import. The default pagination limit is 20 pages; the hard limit is 40. Explicit `truncated` and `partial` flags are returned when YouTube cannot provide every page or every duration/availability detail.

Statuses are explicit: `available`, `unconfigured`, `unavailable`, `quota`, `configuration_error` and `temporary_error`. A missing API key does not stop playback; it only disables the track browser and automatic artwork/titles. On a temporary failure, cached rows are returned with `stale: true`.

The adapter never fabricates a title, duration, artwork or playable video. Entries with private/deleted markers, missing video IDs, non-embeddable status or missing video details are labelled as unavailable or embed-blocked and remain visible.

## Storage

`radio_playlists` stores the account-scoped library:

| Column | Purpose |
| --- | --- |
| `id` | Local UUID primary key |
| `user_id` | Authenticated owner |
| `youtube_id` | Validated YouTube playlist ID |
| `label` | Compatibility/default label |
| `custom_label` | User-defined label, up to 100 characters |
| `tags` | JSON array of supported mood tags |
| `metadata_json` | Cached real playlist metadata |
| `metadata_status` | Last metadata status |
| `metadata_checked_at` | Last successful/failed check time |
| `created_at` | ISO creation timestamp |

Unique constraint: `(user_id, youtube_id)`. Limit: 200 playlists per account.

`radio_playlist_tracks` is an additive cache keyed by `(user_id, playlist_id)`:

| Column | Purpose |
| --- | --- |
| `user_id` | Authenticated owner |
| `playlist_id` | Local playlist UUID |
| `payload_json` | Ordered tracks plus status/partial/truncated flags |
| `fetched_at` | Cache timestamp |

The cache lifetime is 6 hours. `?refresh=1` forces a refresh but is limited to one request per playlist per 20 seconds. Concurrent requests for the same playlist share one in-flight fetch.

## API (all behind the existing companion authentication middleware)

- `GET /api/companion/radio/playlists`
- `POST /api/companion/radio/playlists` — `{ url, label?, tags? }`
- `PATCH /api/companion/radio/playlists/:id` — `{ label, tags }`
- `DELETE /api/companion/radio/playlists/:id`
- `POST /api/companion/radio/playlists/metadata/refresh` — refreshes library metadata, account rate-limited to once per 30 seconds
- `GET /api/companion/radio/playlists/:id/tracks` — cached ordered tracks; add `?refresh=1` to force

Every lookup and mutation includes `user_id = req.user.id`. Another account's playlist returns 404. URL validation allows only HTTPS YouTube hosts (`youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`) and saved playlist ID shapes; credentials, custom ports and temporary `RD…` mixes are rejected. The server never fetches a submitted URL.

## Restore behavior

Playlist, track, volume, mute, layout and floating position are stored per account in `localStorage` under `zuno-radio-state:<userId>` (`pos: { x, y }` in top-left pixels). On reload the library, playlist and selected track are restored in the paused mini bar. No iframe is created and nothing plays until the user presses Play, which opens the floating player at the saved position (clamped into the current viewport) and resumes the restored track.

## ZUNO Live and Vibe Check

ZUNO Live still pauses Radio at the start of a call through the `zuno-live-start` event. Hanging up never resumes music automatically. The per-account opt-out (`zuno-radio-pause:<userId>`) disables that pause.

Vibe Check still has six moods and deterministic saved-playlist recommendations, movie/activity recommendations, empty/error/loading states, and the legacy `/ideas` page. No AI call or invented playable playlist is used.

## Setup

Add a server-side key to `.env`:

```dotenv
YOUTUBE_API_KEY=your-server-side-youtube-data-api-v3-key
```

Restart the Node server. Recommended Google Cloud restrictions: enable only **YouTube Data API v3**, restrict the key to the server's IP where possible, and never expose it in client code. The key is never sent to the browser.

If the key is absent, saving and playing playlists still works; track browsing and automatic titles/artwork report `unconfigured`.

## Tests and verification

Deterministic suite:

```powershell
npm test
```

Result: **10/10 tests passed** across companion, Study, Radio UI/player contract and Radio metadata/API coverage. Radio coverage includes ownership isolation, cache/refresh behavior, pagination/order/durations, unavailable/private/embed-blocked rows, direct selection, video-ID position mapping, prev/next, seek, volume, mute, play-from-mood entering the floating player, title-click opening the studio, collapse-while-playing keeping audio in the floating player, 200 × 200 visible video, drag while playing without pause/restart/remount, keyboard nudge and Home reset, saved position across reload, viewport clamping, mobile edge snapping, route navigation keeping position and playback, refresh restoration without autoplay, background visibility events, Study sharing, Live pause/opt-out, errors/retry, reduced motion and mobile layout.

Real-network verification (opt-in, uses the real `.env` key and real YouTube embed):

```powershell
npm run test:radio:live
```

Result: **1/1 passed**. On 26 October 2026 the real playlist `PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs` returned real ordered entries and playable tracks. The live test verified real playback, pause, resume, direct selection of a different video, next/previous, seek to 30 seconds, volume 35, background-tab playback, collapse to the floating player with audio still playing, dragging the real embed 140 × 100 px without pausing or changing the track, explicit Mini pausing before the bar is shown, and re-expand plus resume at the retained position. Screenshot and test artifacts are written to the OS temp directory.

Static checks:

```powershell
node --check public/radio.js
node --check radio.js
node --check youtube-metadata.js
node --check tests/radio-live-smoke.cjs
git diff --check
```

The repository has no separate lint, type-check or production build script. Study Studio's opt-in live Open Notebook/provider suite (`npm run test:study:live`) was not rerun; Docker services and volumes were untouched.

A source-only checkpoint from before this upgrade is at:

```text
C:\Users\Shaya\AppData\Local\Temp\zuno-radio-upgrade-checkpoint-20261026-211218
```

It excludes `.env`, databases, `node_modules`, logs and runtime data.

## Known limits

- **Full page unload stops audio.** Only same-document dashboard navigation keeps the single mounted player. There is no service worker or hidden-player trick.
- **YouTube requires a visible playing video.** The floating player therefore stays 202 × 274 px with a 200 × 200 embed. The 330 × 66 mini bar cannot host it, so that layout is paused-only. There is no audio-only extraction, hidden iframe or stream download.
- **The floating player is still a visible window.** It can be dragged, docked, reset and minimised while paused, but it cannot become a 66 px bar while YouTube audio is playing.
- **Browser autoplay policies.** A browser or embed may require a second gesture, especially after refresh. The app never auto-plays restored audio without a user action.
- **Background playback depends on the browser/OS.** Collapsing to the floating player no longer pauses it, but the browser, power saving, mobile policies and YouTube still govern background audio.
- **YouTube variability.** Ads, sign-in/age checks, regional blocks, deleted videos, changed privacy and temporary outages can prevent a specific video from playing. Retry and Open on YouTube remain available.
- **No media download/proxy.** Playback stays inside the official IFrame player.
- **API quota and pagination.** Very large playlists may be truncated at the configured page limit, and quota exhaustion disables fresh metadata until the quota resets.
- **Cached availability can age.** The track cache lasts 6 hours; use Refresh metadata or force-refresh tracks after a playlist changes.
- **Live suite uses real external services.** `test:radio:live` requires network access, a valid API key and YouTube embed availability; it is intentionally excluded from `npm test`.

## Relevant files

- `radio.js` — validation, library CRUD, metadata enrichment, track cache/API, ownership and rate limits.
- `youtube-metadata.js` — official Data API metadata and paginated track adapter.
- `public/radio.js` — player controller, three layouts, drag/keyboard placement, persistence, track browser, restore, Media Session, bridge events.
- `public/radio.css` — floating glass card, drag states, paused mini bar, expanded panel, placement/clearance, responsive and accessibility styles.
- `database.js`, `companion.js` — additive schema initialization and authenticated route attachment.
- `index.html`, `study.html`, `public/companion.js`, `public/playcore.js` — mounts, assets and shared-player/Live navigation integration.
- `tests/radio.test.cjs` — deterministic UI/player/API contract and persistence coverage.
- `tests/radio-metadata.test.cjs` — metadata adapter, track adapter and track API/cache coverage.
- `tests/radio-live-smoke.cjs` — opt-in real Data API and real playback verification.
- `tests/fake-youtube-metadata.cjs`, `tests/radio-fixtures.cjs` — deterministic network/player doubles.
- `package.json` — `npm test` and `npm run test:radio:live`.

Official references: [YouTube Data API v3](https://developers.google.com/youtube/v3), [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference), [required embedded-player functionality](https://developers.google.com/youtube/terms/required-minimum-functionality). Existing PLAYCORE colors and typography remain the visual base.
