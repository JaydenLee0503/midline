# Midline

A browser-based facial exercise coach for people recovering from facial paralysis
(Bell's palsy, stroke, and similar). It guides you through five standard rehab
exercises, uses your webcam to measure how evenly the left and right sides of
your face move, and keeps a record so you can see the trend over weeks.

**Midline is a practice and progress-tracking tool. It is not a medical device,
it does not diagnose anything, and its scores are not a clinical measurement.**

**Everything runs locally.** The camera image is processed in the page by
MediaPipe's WASM runtime. No video, image or landmark ever leaves the machine,
and the app makes no third-party network requests at runtime - the model and the
WASM files are served from `public/`. Only the numeric scores are stored, in this
browser's `localStorage`, and the History page can delete them.

## Quick start

```bash
npm install     # also downloads the face model and copies the WASM runtime
npm run dev
```

Then open **http://localhost:5173**.

### If you are on WSL2 (this project's setup)

- Open `http://localhost:5173` in the Windows browser, **not** the
  `http://172.x.x.x:5173` address Vite also prints. Browsers only grant camera
  access on `https://` or on `localhost`, so the LAN address will fail with "this
  page needs a secure connection".
- Windows' camera privacy settings apply: *Settings → Privacy & security → Camera*
  must allow desktop apps to use the camera, or the browser never gets a stream.
- File watching on the 9p mount is unreliable, so Vite is configured to poll.
  It still occasionally misses a change - if an edit does not show up, restart
  the dev server rather than hunting for a bug in the code.
- The repo lives on a Windows drive mounted over 9p, which cannot create
  symlinks, so `npm install` fails on `node_modules/.bin`. `.npmrc` sets
  `bin-links=false` and the npm scripts call each tool by its real path
  (`node node_modules/vite/bin/vite.js`) instead. Vite is configured to poll for
  file changes for the same reason. Both are only needed because of where the
  repo lives - on a Linux filesystem you can delete `.npmrc`, use the usual bare
  commands, and turn polling off for faster, lighter HMR.

## Manual setup steps

`npm install` runs `scripts/fetch-mediapipe.mjs` for you, which:

1. copies the MediaPipe WASM runtime out of `node_modules/@mediapipe/tasks-vision/wasm`
   into `public/mediapipe/wasm/` (~35 MB, no network needed), and
2. downloads `face_landmarker.task` (3.8 MB) into `public/models/`.

Both are gitignored. The script is idempotent and never fails the install - if
the download did not work (offline, proxy, firewall) it prints a warning, the app
shows *"The face landmark model is missing"*, and you can fix it with:

```bash
npm run setup            # retry
npm run setup -- --force # re-download even if a file is already there
```

To do step 2 by hand, save this file to `public/models/face_landmarker.task`:

```
https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
```

## Checking left and right

Left and right always mean **the user's own** left and right. Two assumptions sit
behind that, and both can be wrong on a given machine, so both are adjustable:

- **Blendshapes.** MediaPipe follows the ARKit convention, where `eyeBlinkLeft`
  is the tracked person's own left eye. Midline assumes that.
- **Landmarks.** In an unmirrored camera frame you are looking at the user face
  to face, so their left side has the larger `x`. Midline assumes that. It breaks
  if a webcam or its driver mirrors the feed before the browser sees it.

Mirroring the *display* does not affect either one - the video is flipped with
CSS, while the measurements come from the raw frame.

**To check on your own face:** start a session, press *Show debug values*, and
raise **only your left eyebrow**. The `browOuterUp` row's "left" number should
rise. Then puff **only your left cheek** and watch the `cheek to midline` row.
If a row moves on the wrong side, tick the matching *Swap ... sides* box; the
setting is remembered and is recorded with each session.

In the mirrored video you see yourself as in a mirror, so your left side appears
on the left of the picture. The `Your left` / `Your right` labels are pinned to
the corresponding edges.

## How the measurement works

All of it lives in `src/lib/metrics.ts` as pure functions, with unit tests in
`src/lib/metrics.test.ts`.

**Baseline.** Calibration averages three seconds of a relaxed face. Every
measurement afterwards is a *change from that baseline*, so a resting asymmetry
is not counted as movement.

**Per-side signals.** Each exercise declares how to read its movement:

| Exercise | Signal |
|---|---|
| Eyebrow raise | `browOuterUpLeft` / `browOuterUpRight` blendshapes |
| Gentle eye closure | `eyeBlinkLeft` / `eyeBlinkRight` blendshapes |
| Closed-lip smile | `mouthSmileLeft` / `mouthSmileRight` blendshapes |
| Pucker | each mouth corner's distance from the midline (decreasing) |
| Cheek puff | each cheek outline's distance from the midline (increasing) |

`cheekPuff` and `mouthPucker` have no sided blendshape, hence the landmark
measurements. The midline is the line through the forehead centre (landmark 10)
and the chin (152); a group of landmarks is assigned to a side by which side of
that line it sits on, never by index. Distances are divided by inter-ocular
distance, so moving closer to the camera changes nothing, and normalized
coordinates are un-stretched by the frame's aspect ratio first.

**Symmetry.** For each rep, movement is averaged over the hold phase, then

```
score = round(100 * smaller side / larger side)
```

If neither side passed the exercise's `minMovement`, the rep is reported as
*not enough movement detected* rather than being given the near-100 score that
two tiny noisy numbers would produce. An exercise's score is the **median** of
its reps, so one bad rep cannot decide it; the overall score is the mean of the
exercises that could be scored.

**Head pose.** Yaw, pitch and roll come from the facial transformation matrix.
Frames more than ~13° away from the pose you held during calibration are ignored
and the countdown politely waits - measuring against *your* neutral rather than
against dead ahead matters, because a camera below eye level puts a constant
pitch offset on every frame.

**Synkinesis.** During smile and pucker reps, each side's blink value is compared
with its relaxed baseline; during eye closure, each mouth corner's movement from
its relaxed position is measured. A side is flagged when the median across the
scored reps crosses the exercise's threshold. Flags are only raised for reps
where the intended movement actually happened.

**Smoothing.** The live bars are smoothed with an EMA. Scores are not - they are
averages over the whole hold phase, which is smoothing enough.

### Tuning

`minMovement`, `displayScale` and the synkinesis `threshold`s in
`src/lib/exercises.ts` are deliberately forgiving starting points, in each
signal's own units (blendshapes are 0-1; landmark distances are fractions of
inter-ocular distance). Open the debug panel during a session to see what your
face and camera actually produce, and edit those numbers. Nothing else needs to
change.

### Adding an exercise

Add an entry to `EXERCISES` in `src/lib/exercises.ts`. The session engine,
screens, results and history all read the list; nothing else needs editing.

## Project structure

```
scripts/fetch-mediapipe.mjs  model download + WASM copy
src/lib/metrics.ts           all measurement maths (pure, tested)
src/lib/exercises.ts         the programme, as data
src/lib/sessionMachine.ts    the rep/phase clock (pure, tested)
src/lib/sessionController.ts calibration, reps, results (tested)
src/lib/storage.ts           localStorage, defensively parsed
src/lib/history.ts           shaping sessions for the chart (pure, tested)
src/lib/overlay.ts           canvas landmark + midline drawing
src/hooks/useCamera.ts       getUserMedia and its failure modes
src/hooks/useFaceLandmarker.ts  loads the model once
src/hooks/useDetectionLoop.ts   the requestAnimationFrame loop
src/components/              one component per screen
```

The detection loop never sets React state. Each frame goes to the controller,
which publishes a snapshot about ten times a second that the UI reads through
`useSyncExternalStore`; the canvas overlay is drawn straight from the loop. So
detection runs at video rate while React renders at ~10 Hz.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server on http://localhost:5173 |
| `npm run build` | typecheck, then production build |
| `npm run preview` | serve the production build |
| `npm test` | Vitest unit tests |
| `npm run test:watch` | tests in watch mode |
| `npm run typecheck` | TypeScript only |
| `npm run setup` | re-fetch the model and WASM files |

## Design notes

Users may be older adults or stroke survivors, so: 18px base type, large hit
targets, high contrast, a calm palette, and nothing that flashes. The wording
never asks anyone to try harder or go faster - rehab values slow, controlled
movement, so the app asks for that and nothing more. Colour is never the only
signal: left/right are labelled as well as coloured, and scores are always
accompanied by a sentence.

**The landing page** is full-bleed and deliberately sparse: one image, a short
headline, one obvious action per screenful. The artwork
(`src/components/art/LandmarkField.tsx`) is generated SVG, not a photograph - it
keeps the "nothing is requested from anywhere else" promise, stays crisp at any
size, and its subject is the thing the app actually does: a landmark mesh
mirrored about a glowing midline, blue on the user's left and amber on their
right, which is the same colour language the exercise and results screens use.
The same mesh reappears behind the overall score, the one moment in a session
worth a little ceremony.

Two things the sparse treatment does **not** drop: the "not a medical device"
note and the privacy note. They are trimmed to two lines each and still sit on
the landing page.

The working screens stay plain on purpose. Nothing competes with the exercise
cue while somebody is mid-repetition.

## Not in this version

Structured for, but not built: game modes per exercise, a PDF summary for
clinicians, accounts and sync, and other languages. The exercise list is data,
results are plain serializable records, and all copy sits in the components, so
each of those is an addition rather than a rewrite.

## Limitations worth knowing

- Blendshape scores are a model's estimate, not a physical measurement. They are
  good for tracking *your own* change over time, and poor for comparing one
  person with another.
- Consistent lighting and camera position matter more than anything else for
  comparable numbers between sessions.
- The thresholds have not been validated against any clinical scale.
