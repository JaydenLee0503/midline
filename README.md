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
2. downloads three models into `public/models/`: `face_landmarker.task` (3.8 MB)
   for the exercises, and `pose_landmarker_lite.task` (5.8 MB) plus
   `hand_landmarker.task` (7.8 MB) for the game.

Both are gitignored. The script is idempotent and never fails the install - if
the download did not work (offline, proxy, firewall) it prints a warning, the app
shows *"The face landmark model is missing"*, and you can fix it with:

```bash
npm run setup            # retry
npm run setup -- --force # re-download even if a file is already there
```

To do step 2 by hand, save these into `public/models/`, keeping the file names:

```
https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
```

The game is code split, so its two models are only fetched by the browser when
somebody actually opens it.

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

## The stress reliever game

A separate mode, reachable from the landing page and the header. Targets appear
for one minute and you punch them; straights, hooks and uppercuts each knock the
shape about differently. It is not an exercise, it never appears inside a rehab
session, and nothing it records touches the session scores.

**Tracking uses two models together.** The pose model gives the body frame -
shoulders for scale, elbows for telling an uppercut from a hook - and the hand
model gives all 21 joints of each hand. The strike point is the **knuckle
centroid**, not the pose model's single wrist dot: it is steadier, and it is
where a punch actually lands. The full hand skeleton is drawn on screen, so you
can see at a glance that tracking is working.

The two run at different rates. Hands are re-read on every analysed frame
because fists move fast and that is where precision matters; the pose runs on
every third, because the body frame barely changes in 60ms. Hands also drop out
during fast motion, so the pose wrist is always there as a fallback, and the HUD
says which is in use. Hands are matched to arms by **which wrist each is nearest**,
never by the model's own left/right naming, which is reported as though you were
looking in a mirror.

Two more things make detection work (`src/lib/punch.ts`, pure and unit tested):

- Speed is measured in **shoulder widths per second**, so it does not matter how
  far from the camera you sit.
- A jab thrown straight at the camera barely moves on screen, so the detector
  also watches how fast the arm is *extending*. A punch fires on whichever
  signal crosses first, and the type is read from which component dominates -
  upward travel with a bent elbow is an uppercut, sideways is a hook, extension
  is a straight.

A punch fires the moment the threshold is crossed rather than at the peak, so
the game feels responsive, and hit testing uses the fist's whole **swept path**
between frames - otherwise a fast punch tunnels straight through a target.

**Choose what to hit.** Stress ball, punching bag, chair, crate or pillow
(`src/lib/objects.ts`). Each is a closed outline that gets resampled into an
even ring of vertices, so adding another is a matter of drawing its silhouette.
Hits are tested against that **actual outline**, deformations included - the
polygon drawn on screen is the polygon you can hit, so the gap between a chair's
legs really is a gap.

**Everything behaves like clay** (`src/lib/targets.ts`). Each vertex carries two
displacements: an elastic one that springs back and makes a fresh hit ripple,
and a plastic one that does not. A fraction of every dent stays, so an object
slowly keeps the shape you beat into it, with a bulge pushed out the far side as
though the material had nowhere else to go. How much stays is per object: a
pillow takes a deep set, a chair barely gives. On top of that the body takes
knockback, spin and a squash along the line of the punch, so uppercuts loft with
backspin, hooks spin sideways and straights drive away and flatten.

**The sound** (`src/lib/audio.ts`) is synthesised with the Web Audio API - there
are no audio files to download. Each impact is three layers: a bright transient
for the slap, a low sine whose pitch drops fast for the thud, and a band of
noise for the crunch, with small random detunes so repeated hits do not sound
looped. Each object has its own timbre, so a pillow is a dull thump and a crate
is a woody crack.

**Scoring** rewards variety and accuracy rather than force: uppercuts and hooks
are worth more than straights, centre hits are worth half as much again, and the
multiplier grows every third hit. Power contributes, but a gentle punch that
lands still scores. Wild swings at nothing never break a streak - only letting a
target time out does.

**Playing it comfortably.** It works seated, one arm is enough, and *Gentle mode*
roughly halves the speed a punch needs before it registers. Sound can be turned
off. Nothing flashes; the "running out of time" cue is a slow pulse.

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
src/lib/punch.ts             hand/pose punch detection + scoring (pure, tested)
src/lib/objects.ts           the punchable objects, as outlines (tested)
src/lib/targets.ts           clay deformation + outline collision (tested)
src/lib/gameController.ts    the round: spawning, hits, effects (tested)
src/lib/gameRender.ts        canvas drawing for the game
src/lib/audio.ts             synthesised sound effects
src/hooks/useCamera.ts       getUserMedia and its failure modes
src/hooks/useFaceLandmarker.ts  loads the model once
src/hooks/useDetectionLoop.ts   the requestAnimationFrame loop
src/hooks/usePoseLandmarker.ts  loads the pose model (game only)
src/hooks/useHandLandmarker.ts  loads the hand model (game only)
src/hooks/useGameLoop.ts        the game's animation loop
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
targets, high contrast, and nothing that flashes. The wording never asks anyone
to try harder or go faster - rehab values slow, controlled movement, so the app
asks for that and nothing more. Colour is never the only signal: left/right are
labelled as well as coloured, and scores always come with a sentence.

**The look is flat, illustrated and square.** Painted outdoor bands - sky,
ridges, meadow, timber, forest - meet along drawn edges rather than ruled lines,
with content sitting straight on the scenery instead of inside cards. Buttons
and panels are stickers: a flat block, a heavy ink outline, and a hard offset
shadow that presses in when pushed.

**There is no corner radius anywhere in the interface.** Not on buttons, panels,
inputs, bars or the video frame. `border-radius: 0` from the reset is the only
radius rule in the built stylesheet, and that is worth keeping an eye on: this
is Tailwind, so even the word "rounded" sitting in a *comment* is enough for it
to emit a `.rounded` utility into the bundle.

**The scenery is generated SVG** (`src/components/art/Scene.tsx`), not artwork
files - clouds are grouped circles, ridges and grass are deterministic jitter
(a small hash, never `Math.random`, so hills never change between renders). It
keeps the "nothing is requested from anywhere else" promise and stays crisp at
any size. The landmark mesh from the hero is the app's own subject matter, drawn
in ink on the pale sky and in pale lines on the dark bands.

**On the typeface.** The reference site uses Satoshi and Castledown, both
third-party faces. Loading either from a CDN would break the promise that the
app requests nothing from anywhere else, and shipping them is a licensing call
that is not mine to make, so the display and body faces are a system stack
behind two tokens, `--font-display` and `--font-sans`. Self-hosting a face means
dropping the files into `public/fonts/` and changing those two lines - it is the
one part of the reference look that is not reproduced here.

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
