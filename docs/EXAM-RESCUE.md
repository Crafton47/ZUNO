# Exam Rescue and Study Studio — 27 October 2026

Implemented in the existing Express/SQLite/Open Notebook application. No containers, volumes, existing notebooks or user records were reset. Pre-existing uncommitted changes were preserved. A source-only checkpoint of the original files touched early in this work is at `C:\Users\Shaya\AppData\Local\Temp\zuno-source-checkpoint-20261027-114548` (no credentials or databases).

## Using it

Open Study Studio, select a notebook, then **Exam Rescue**. The Command Center also has a shortcut and shows the next session. Select sources, analyze them or enter topics manually, review evidence/estimates/prerequisites, enter daily availability and the exam start, and preview the timetable. **Confirm & save linked missions** applies the preview. Refresh restores saved plans and progress. Start studying from a linked Mission opens the corresponding notebook/topic.

The running Node server must load the updated code (`npm start` after stopping the old development server normally). The existing Docker services and provider configuration are reused; no new keys or packages are required. Docker Desktop was started during verification and the existing pinned services returned healthy. Normal startup creates the additive tables automatically.

## What changed

- Four primary sections: My Notebooks, Ask ZUNO, Practice Lab, Exam Rescue. Charcoal surfaces, lime primary controls, blue learning accents, coral/pink details, larger headings, readable answer cards and a single page reading flow replace the purple foundation. Existing IDs, Radio and learning tools remain.
- Notebook cards show document counts, last-opened dates, Open actions and rename/delete menus. Existing real upload progress and processing status remain.
- Ask retains safe Markdown, citations, copy/save and answer tools, and adds response styles. Practice retains quizzes, flashcards and exam formats; short-answer review uses the existing grounded chat route. Quiz results are persisted as self-reported practice evidence.
- Exam setup includes timezone, daily windows and caps, focus/break lengths, travel/preparation buffer, learning preference, preparation goal and optional reminders. Topic estimates, confidence and prerequisites are editable.
- Balanced, Sprint and Deep strategies; timeline/daily checklist views; completion, skip, move, shorten, extend and confirmed rescheduling; transparent uncovered-work and progress indicators. Shortening retains the removed minutes as unscheduled work.
- The existing orbital mascot is reused. Navigation/cards/session entrances, hover/pressed states, real upload/progress indicators and a brief completion celebration are lightweight CSS. Existing quiz feedback and flashcard flips remain. Reduced motion disables animation.

## Topic analysis and approximate workload

`POST /api/companion/study/notebooks/:id/rescue/analyze` constructs Open Notebook context from selected, ownership-checked local source IDs. Only sources returned within that selection are accepted. The AI classifies real topics/modules, conceptual/problem/formula/definition/algorithm material, approximate minutes, priorities and prerequisites. It is instructed to use weightage only when explicitly supported by official material or previous-year questions.

Each proposed topic must include a verbatim excerpt found in the actual extracted source text. Unsupported entries are omitted. This checks the existence of supporting text, not the semantic correctness of every classification; students review evidence before applying a plan. Empty/scanned/failed extraction reports the limitation and supports manual topics. Context is capped at 180,000 characters and uses fresh temporary upstream chat sessions.

Reviewed estimates are scaled by strategy (Sprint 0.75, Balanced 1, Deep 1.4) and confidence (weak 1.25, comfortable 0.85). A matching saved quiz below 60% suggests weak confidence during analysis; the student can override it. Work is split into learning, practice, recall, revision and mock-practice activities; problem topics get a greater practice share. Rounded short activities can make actual totals slightly larger than a raw estimate. These are planning estimates, not learning guarantees or exam-success predictions.

## Deterministic scheduling

`exam-engine.js` contains a pure scheduler with an injectable clock. Luxon validates IANA timezones, local date boundaries, nonexistent DST times and ambiguous times (explicit offsets required for ambiguity). Availability is limited to one daytime window per date, 07:00–22:00, and no more than eight study hours daily across exam plans. Blocks end before the exam minus the entered preparation buffer. Only recall/revision may be newly placed on exam day.

Topics are ordered by priority while respecting the prerequisite graph; cycles are rejected. Work is split at the preferred session length. The first feasible available slot is assigned, avoiding commitments and inserting breaks. A five-minute start margin permits preview review. Completed work is preserved and still reserves its time if marked complete early. Unplaceable work and blocked dependent topics remain explicitly uncovered. The engine is a deterministic greedy planner, not a global optimal packing solver.

Ordinary Missions store deadlines, not durations: they reserve a clearly labeled, editable one-hour assumed busy window. Exact Exam Rescue start/end times are used for linked study commitments. Preview-time overrides affect the proposed plan, not unrelated task records. Updating ordinary planner tasks after a preview invalidates confirmation; generating a new preview accounts for the changes. Future unrelated tasks added after applying a plan can still create conflicts until the plan is refreshed/rescheduled.

## Persistence, authorization and synchronization

Four additive tables are created by `exam-rescue.init()` through `study.init()`:

| Table | Purpose |
| --- | --- |
| `exam_plans` | Owner/notebook, revision and JSON setup, blocks, uncovered work |
| `exam_previews` | Owner/notebook-bound, 15-minute confirmation previews |
| `exam_task_links` | Unique plan/block to actual Mission ID |
| `study_quiz_results` | Notebook/owner/topic, score, total, timestamp |

The existing `schedule_tasks` and `study_tasks` tables are reused without destructive migrations. Updates use the existing transaction/save-to-disk interface. Completion reuses the planner reward function. Plan reads reconcile Mission completion; planner edits of study deadlines redirect users to Exam Rescue validation. Calendar exports use exact study end times; study alarms and nudges are opt-in. Other Missions retain their normal reminder behavior.

Rescheduling stores a preview, preserves completed sessions, recalculates unfinished work in remaining availability and lists changed times. Confirmation checks both the plan revision and a fingerprint of current planner tasks. Existing links are reused to avoid duplicates. Only this plan's unfinished Mission entries are moved or removed from the calendar; uncovered work remains in the plan. Changed workload estimates reconcile completed credit and explicitly report replaced entries. Existing topics cannot silently be removed during rescheduling.

All new study routes remain behind existing authentication, `STUDY_OWNER_ID`, and notebook ownership checks. Browser code receives no provider credentials. Preview IDs are not sufficient without matching owner and notebook. AI and user text are rendered with DOM text nodes or the existing safe Markdown renderer.

Other routes: `GET /rescue/next`; notebook-scoped `GET /rescue`, `POST /rescue/preview`, `POST /rescue/apply`, `PATCH /rescue/:planId/blocks/:blockId`, and `POST /rescue/quiz-result`.

## Files

New: `exam-engine.js`, `exam-rescue.js`, `public/exam-rescue.js`, `public/exam-next.js`, `public/study-playcore.css`, `tests/exam-rescue.test.cjs`, this report.

Updated: `study.js`, `study.html`, `public/study.js`, `scheduler.js`, `public/scheduler.js`, `index.html`, `package.json`, `tests/study-live.cjs`, `AGENTS.md`. Existing `database.js` already calls Study initialization, so no additional change was needed there for this feature. Existing modified files unrelated to this work were left intact.

## Verification

- `npm test`: 19 tests cover the existing authentication, planner, rewards, simulated voice lifecycle, Radio, metadata and citation suites, plus deterministic scheduling and an isolated real Express/SQLite/Playwright workflow.
- New checks cover timezone/DST errors, exam cutoff/rest/breaks, daily caps, commitments, prerequisites/cycles, insufficient capacity, strategies, source evidence rejection, cross-user access, confirm-only saves, replay/stale-preview rejection, completion/rewards, no duplicate Missions, preserving unrelated tasks, disk reload, cross-plan overlap, UI analysis/preview/apply, section navigation, grounded Markdown, desktop/mobile overflow and reduced motion.
- `npm run test:study:live`: uses temporary ZUNO accounts/database and only test-created upstream material. Verified real TXT/PDF ingestion, actual provider answers/citations, saved notes, summaries, topic extraction with verbatim evidence, three-day scheduling, linked Missions, completion, rescheduling, restart persistence, owner isolation, offline behavior and responsive layout. Existing user notebooks are not altered.
- JavaScript syntax checks and `git diff --check` were run. This vanilla JavaScript app has no TypeScript configuration, lint script or production build pipeline; those commands are not available. Real microphone/speaker conversations and actual YouTube playback were not newly exercised; existing simulated lifecycle/player regression tests passed.

## Practical limits

- Single trusted local owner remains mandatory. This does not implement public multi-user Open Notebook isolation.
- OCR and page-accurate PDF citations are still outside the integration. Source evidence is extracted text.
- One availability window per day, fixed 07:00–22:00 rest boundary; not a rotating-shift or arbitrary sleep schedule planner.
- A greedy planner can leave work uncovered even when a more complex rearrangement might fit it. With very little time, some revision/practice may also remain uncovered; the UI does not promise full coverage.
- Quiz scores, viewed/practised/recall completion and readiness are observable/self-reported indicators, not verified mastery. Mock blocks launch the existing study/quiz tools, not a new proctored timed-exam system. The preparation-goal field is retained for reference; it does not infer official weightage.
- New source analysis is performed for new exams. Existing exams keep their reviewed topic identities so completed work remains attached. Create another exam to replace its syllabus.
- Notebook metadata shows document count and last-opened time; the existing schema does not supply a true last-content-edited timestamp. No new math typesetting dependency is introduced.
