# Mobile and browser compatibility — 27 October 2026

## Scope and evidence

`node --test tests/release-mobile.test.cjs` runs local pages with a disposable
SQLite database, a synthetic account, fake Gemini responses and intercepted
Study responses. It disables `.env` loading and blocks external browser
requests. The Study layout checks do **not** verify Open Notebook or live AI.

The suite checks these CSS viewport widths at 900px height in each installed
engine: **320, 360, 375, 390, 430, 768, 1024, 1280 and 1440**. It also checks
the dashboard at **844 × 390** in landscape. Touch input is enabled; these are
desktop browser engine tests, not physical phones or complete device emulation.

| Browser | Evidence | Limit |
| --- | --- | --- |
| Playwright Chromium | Nine widths, landscape, touch taps and simulated microphone denial | Not installed Android Chrome or branded desktop Chrome/Edge |
| Playwright Firefox 157 | Same responsive and interaction coverage | Not physical Android Firefox |
| Playwright WebKit 27.2 on Windows | Same responsive coverage; unsupported-microphone message | Not Safari or iOS; this binary has no `mediaDevices` API |
| Android Chrome / Android tablet | NOT TESTED on device | Manual verification required |
| iPhone Safari / iPhone Chrome / iPad Safari | NOT TESTED on device | Manual verification required; Windows WebKit does not establish iOS behavior |
| Branded desktop Edge / Chrome / macOS Safari | NOT TESTED | Engine coverage is a useful preliminary check only |

The deterministic checks cover login and registration page layout, Command
Center layout, the personal-context dialog, all four Study direct sections,
notebook selection and refresh preservation, three Exam Rescue setup steps,
upload-form placement, horizontal overflow, touch activation, basic keyboard
focus movement and permission-denial recovery where a microphone API exists.
No horizontal overflow was observed in these tested states. The tests use
reduced-motion mode. They do not establish full WCAG compliance.

## Bug fixed

Exam Rescue previously moved `#upload-form` into a host nested inside
`#rescue-form`. All nine widths reproduced an invalid nested form in Step 2.
The planner form now wraps its submit controls beside the wizard panes, and
the static planner fields use explicit form association. The upload and
planner forms remain independent while preserving every existing ID.

Regression checks verify no nested forms, the document input belongs to the
upload form, the upload returns to its original container in Step 3, and the
planner submit button still belongs to `#rescue-form`. No responsive CSS
changes or product redesign were needed.

## Platform and accessibility limitations

- Voice requires HTTPS (or localhost), microphone permission, AudioContext
  and AudioWorklet support. Permission denial must leave the call retryable.
- Playback may need a user gesture. Screen locking, background tabs, phone
  calls and OS audio interruptions can suspend playback; background music
  and uninterrupted voice are not guaranteed.
- YouTube embedding, unavailable videos, account/geographic restrictions,
  autoplay and player errors remain subject to YouTube/browser policy. This
  offline suite blocks YouTube, so it makes no real playback claim.
- Existing Radio styles include safe-area insets. Their real notch/home-bar
  behavior, the virtual keyboard and dynamic browser toolbars need device tests.
- Basic keyboard behavior and reduced-motion layouts were exercised. A full
  screen-reader, contrast, 200% text zoom and dialog focus audit remains manual.
- Heavy-animation battery use and performance on ordinary student phones
  have not been measured. Desktop automation cannot establish those results.

## Required manual device checklist

On Android Chrome, iPhone Safari, iPhone Chrome and a tablet, verify:

1. Sign in, sign out, expiry and refresh; switch sections using touch and keyboard.
2. Create/edit/complete a mission, use date/time pickers, reveal a movie reward.
3. Upload a real PDF to the owner's notebook, inspect citations, run a quiz
   and flashcards, preview/apply/reschedule an exam, then refresh.
4. Open and close dialogs in portrait and landscape; open the software
   keyboard; check focus, readable text, safe areas and no covered controls.
5. Start Radio with a tap, minimize/expand/move it, switch Study sections,
   and confirm controls remain reachable. Test a blocked/unavailable video.
6. Allow and deny microphone access; start/end a voice call, interrupt it
   with a phone call or backgrounding, and recover without duplicate audio.
7. Test reduced motion, 200% text zoom, screen reader navigation and touch
   targets; measure responsiveness/battery impact on an ordinary phone.

## PWA assessment

The application currently runs as an online website. There is no service
worker, offline data cache or installation guarantee. A manifest could be
added separately after owner-approved branding/icon review, but it would
not make authenticated APIs, AI, YouTube or notebook processing work offline.
No private content caching was added for this release-hardening pass.

## Verification result

Final executable results are recorded in `ZUNO_RELEASE_PROGRESS.md` and
`GITHUB_READINESS.md`. Device, live playback and accessibility checks above
remain NOT TESTED; they must not be inferred from a passing engine smoke test.
