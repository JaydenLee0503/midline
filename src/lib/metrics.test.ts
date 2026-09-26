import { describe, expect, it } from 'vitest';
import { EXERCISES_BY_ID } from './exercises';
import {
  buildBaseline,
  ema,
  faceGeometry,
  findSynkinesis,
  headPoseFromMatrix,
  isHeadAligned,
  measureRep,
  measureSides,
  movementFromBaseline,
  overallScore,
  poseProblem,
  sidedBlendshape,
  sidedMidlineDistance,
  summariseExercise,
  symmetryFrom,
  toFaceLocal,
  CHEEK_GROUPS,
  MOUTH_CORNERS,
} from './metrics';
import { DEFAULT_SIDE_CONFIG, type ExerciseDef, type FaceSample, type Landmark, type Sided } from './types';

/* ------------------------------------------------------------------ *
 * A synthetic face, built so the expected metric values are exact.
 *
 * Distances are given in inter-ocular units, measured from the midline, with
 * positive meaning the user's own left. Everything is then converted into the
 * normalized, aspect-stretched coordinates MediaPipe actually produces.
 * ------------------------------------------------------------------ */

interface FaceOptions {
  aspect?: number;
  /** Scales the whole face, i.e. moves the user towards or away from the camera. */
  scale?: number;
  /** Head roll in degrees. */
  roll?: number;
  /** Mouth-corner distance from the midline, per side, in inter-ocular units. */
  mouth?: Sided<number>;
  /** Cheek distance from the midline, per side, in inter-ocular units. */
  cheek?: Sided<number>;
  blendshapes?: Record<string, number>;
  matrix?: number[];
}

const BASE_BLENDSHAPES: Record<string, number> = {
  browOuterUpLeft: 0,
  browOuterUpRight: 0,
  eyeBlinkLeft: 0.05,
  eyeBlinkRight: 0.05,
  mouthSmileLeft: 0.02,
  mouthSmileRight: 0.02,
  cheekPuff: 0,
  mouthPucker: 0,
};

function makeFace(options: FaceOptions = {}): FaceSample {
  const aspect = options.aspect ?? 16 / 9;
  const scale = options.scale ?? 1;
  const iod = 0.12 * scale;
  const mouth = options.mouth ?? { left: 0.45, right: 0.45 };
  const cheek = options.cheek ?? { left: 0.95, right: 0.95 };
  const roll = ((options.roll ?? 0) * Math.PI) / 180;

  const centreX = 0.5 * aspect;
  const centreY = 0.45;
  const down = { x: Math.sin(roll), y: Math.cos(roll) };
  const lateral = { x: down.y, y: -down.x };

  const landmarks: Landmark[] = new Array<Landmark>(478).fill({ x: 0.5, y: 0.5 });
  const put = (index: number, alongMidline: number, sideways: number): void => {
    const isoX = centreX + down.x * alongMidline + lateral.x * sideways;
    const isoY = centreY + down.y * alongMidline + lateral.y * sideways;
    landmarks[index] = { x: isoX / aspect, y: isoY };
  };

  put(10, -0.3 * scale, 0); // forehead centre (the geometry origin)
  put(152, 0.3 * scale, 0); // chin
  put(33, -0.1 * scale, -iod / 2); // outer eye corners, iod apart
  put(263, -0.1 * scale, iod / 2);
  put(61, 0.17 * scale, mouth.left * iod); // user's left mouth corner
  put(291, 0.17 * scale, -mouth.right * iod);
  // CHEEK_GROUPS[0] is deliberately placed on the user's RIGHT: the metric has
  // to work out sides from position, not from which index we happened to pick.
  for (const index of CHEEK_GROUPS[0]) put(index, 0.05 * scale, -cheek.right * iod);
  for (const index of CHEEK_GROUPS[1]) put(index, 0.05 * scale, cheek.left * iod);

  return {
    t: 0,
    landmarks,
    blendshapes: { ...BASE_BLENDSHAPES, ...options.blendshapes },
    headPose: options.matrix ? headPoseFromMatrix(options.matrix) : { yaw: 0, pitch: 0, roll: 0 },
    aspect,
  };
}

function repeatFace(count: number, options: FaceOptions = {}): FaceSample[] {
  return Array.from({ length: count }, (_unused, index) => ({
    ...makeFace(options),
    t: index * 33,
  }));
}

function rotationMatrix(rows: number[][]): number[] {
  const data = new Array<number>(16).fill(0);
  data[15] = 1;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) data[col * 4 + row] = rows[row]![col]!;
  }
  return data;
}

const CONFIG = DEFAULT_SIDE_CONFIG;
const pucker = EXERCISES_BY_ID['pucker'] as ExerciseDef;
const smile = EXERCISES_BY_ID['smile-closed'] as ExerciseDef;
const cheekPuff = EXERCISES_BY_ID['cheek-puff'] as ExerciseDef;

/* ------------------------------------------------------------------ */

describe('symmetryFrom', () => {
  it('scores equal movement as 100 and names no weaker side', () => {
    const outcome = symmetryFrom({ left: 0.4, right: 0.4 }, 0.05);
    expect(outcome.status).toBe('ok');
    expect(outcome.score).toBe(100);
    expect(outcome.weakerSide).toBeNull();
  });

  it('scores the smaller side over the larger side', () => {
    expect(symmetryFrom({ left: 0.2, right: 0.4 }, 0.05).score).toBe(50);
    expect(symmetryFrom({ left: 0.3, right: 0.4 }, 0.05).score).toBe(75);
  });

  it('names the weaker side', () => {
    const outcome = symmetryFrom({ left: 0.1, right: 0.4 }, 0.05);
    expect(outcome.weakerSide).toBe('left');
    expect(outcome.strongerSide).toBe('right');
  });

  it('reports "not enough movement" instead of a flattering score', () => {
    // Two nearly identical tiny numbers would otherwise score close to 100.
    const outcome = symmetryFrom({ left: 0.004, right: 0.0041 }, 0.05);
    expect(outcome.status).toBe('insufficient');
    expect(outcome.score).toBeNull();
  });

  it('scores one side moving and the other not as 0, not as unmeasurable', () => {
    const outcome = symmetryFrom({ left: 0, right: 0.4 }, 0.05);
    expect(outcome.status).toBe('ok');
    expect(outcome.score).toBe(0);
  });
});

describe('movementFromBaseline', () => {
  it('measures growth for increase signals and ignores movement the wrong way', () => {
    const movement = movementFromBaseline({ left: 0.5, right: 0.1 }, { left: 0.2, right: 0.2 }, 'increase');
    expect(movement.left).toBeCloseTo(0.3);
    expect(movement.right).toBe(0);
  });

  it('measures shrinkage for decrease signals, as pucker needs', () => {
    const movement = movementFromBaseline({ left: 0.35, right: 0.5 }, { left: 0.45, right: 0.45 }, 'decrease');
    expect(movement.left).toBeCloseTo(0.1);
    expect(movement.right).toBe(0);
  });
});

describe('face geometry and sides', () => {
  it('puts the user’s left on the positive side of the midline', () => {
    const sample = makeFace();
    const geometry = faceGeometry(sample.landmarks, sample.aspect, CONFIG)!;
    expect(geometry).not.toBeNull();
    // Landmark 61 is the user's left mouth corner in the fixture.
    expect(toFaceLocal(sample.landmarks[61]!, geometry).v).toBeGreaterThan(0);
  });

  it('assigns landmark groups to sides by position, not by index', () => {
    const sample = makeFace({ mouth: { left: 0.5, right: 0.4 }, cheek: { left: 1.1, right: 0.9 } });
    const geometry = faceGeometry(sample.landmarks, sample.aspect, CONFIG)!;

    const corners = sidedMidlineDistance(
      sample.landmarks,
      [[MOUTH_CORNERS[0]], [MOUTH_CORNERS[1]]],
      geometry
    )!;
    expect(corners.left).toBeCloseTo(0.5, 6);
    expect(corners.right).toBeCloseTo(0.4, 6);

    const cheeks = sidedMidlineDistance(sample.landmarks, CHEEK_GROUPS, geometry)!;
    expect(cheeks.left).toBeCloseTo(1.1, 6);
    expect(cheeks.right).toBeCloseTo(0.9, 6);
  });

  it('gives the same numbers when the user is closer to the camera', () => {
    const near = makeFace({ scale: 1.6, mouth: { left: 0.5, right: 0.4 } });
    const far = makeFace({ scale: 0.7, mouth: { left: 0.5, right: 0.4 } });
    const measure = (sample: FaceSample): Sided<number> =>
      sidedMidlineDistance(
        sample.landmarks,
        [[MOUTH_CORNERS[0]], [MOUTH_CORNERS[1]]],
        faceGeometry(sample.landmarks, sample.aspect, CONFIG)!
      )!;
    expect(measure(near).left).toBeCloseTo(measure(far).left, 6);
    expect(measure(near).right).toBeCloseTo(measure(far).right, 6);
  });

  it('gives the same numbers for a 4:3 and a 16:9 frame', () => {
    const wide = makeFace({ aspect: 16 / 9, mouth: { left: 0.5, right: 0.4 } });
    const narrow = makeFace({ aspect: 4 / 3, mouth: { left: 0.5, right: 0.4 } });
    const measure = (sample: FaceSample): number =>
      sidedMidlineDistance(
        sample.landmarks,
        [[MOUTH_CORNERS[0]], [MOUTH_CORNERS[1]]],
        faceGeometry(sample.landmarks, sample.aspect, CONFIG)!
      )!.left;
    expect(measure(wide)).toBeCloseTo(measure(narrow), 6);
  });

  it('still separates the sides correctly with the head tilted', () => {
    const sample = makeFace({ roll: 12, mouth: { left: 0.5, right: 0.4 } });
    const geometry = faceGeometry(sample.landmarks, sample.aspect, CONFIG)!;
    const corners = sidedMidlineDistance(
      sample.landmarks,
      [[MOUTH_CORNERS[0]], [MOUTH_CORNERS[1]]],
      geometry
    )!;
    expect(corners.left).toBeCloseTo(0.5, 6);
    expect(corners.right).toBeCloseTo(0.4, 6);
  });

  it('swaps sides when the landmark mapping is flipped', () => {
    const sample = makeFace({ mouth: { left: 0.5, right: 0.4 } });
    const flipped = faceGeometry(sample.landmarks, sample.aspect, {
      ...CONFIG,
      swapLandmarks: true,
    })!;
    const corners = sidedMidlineDistance(
      sample.landmarks,
      [[MOUTH_CORNERS[0]], [MOUTH_CORNERS[1]]],
      flipped
    )!;
    expect(corners.left).toBeCloseTo(0.4, 6);
    expect(corners.right).toBeCloseTo(0.5, 6);
  });
});

describe('sidedBlendshape', () => {
  const scores = { browOuterUpLeft: 0.7, browOuterUpRight: 0.2 };

  it('reads the named sides by default', () => {
    expect(sidedBlendshape(scores, 'browOuterUpLeft', 'browOuterUpRight', CONFIG)).toEqual({
      left: 0.7,
      right: 0.2,
    });
  });

  it('honours the swap toggle', () => {
    expect(
      sidedBlendshape(scores, 'browOuterUpLeft', 'browOuterUpRight', {
        ...CONFIG,
        swapBlendshapes: true,
      })
    ).toEqual({ left: 0.2, right: 0.7 });
  });

  it('treats a missing blendshape as no movement', () => {
    expect(sidedBlendshape({}, 'nopeLeft', 'nopeRight', CONFIG)).toEqual({ left: 0, right: 0 });
  });
});

describe('headPoseFromMatrix', () => {
  it('reads a frontal face as no rotation', () => {
    const pose = headPoseFromMatrix(rotationMatrix([[1, 0, 0], [0, 1, 0], [0, 0, 1]]))!;
    expect(pose.yaw).toBeCloseTo(0, 6);
    expect(pose.pitch).toBeCloseTo(0, 6);
    expect(pose.roll).toBeCloseTo(0, 6);
  });

  it('recovers a 30 degree turn, a 20 degree nod and a 15 degree tilt', () => {
    const deg = (value: number): number => (value * Math.PI) / 180;
    const yawMatrix = rotationMatrix([
      [Math.cos(deg(30)), 0, Math.sin(deg(30))],
      [0, 1, 0],
      [-Math.sin(deg(30)), 0, Math.cos(deg(30))],
    ]);
    const pitchMatrix = rotationMatrix([
      [1, 0, 0],
      [0, Math.cos(deg(20)), -Math.sin(deg(20))],
      [0, Math.sin(deg(20)), Math.cos(deg(20))],
    ]);
    const rollMatrix = rotationMatrix([
      [Math.cos(deg(15)), -Math.sin(deg(15)), 0],
      [Math.sin(deg(15)), Math.cos(deg(15)), 0],
      [0, 0, 1],
    ]);
    expect(headPoseFromMatrix(yawMatrix)!.yaw).toBeCloseTo(30, 4);
    expect(headPoseFromMatrix(pitchMatrix)!.pitch).toBeCloseTo(20, 4);
    expect(headPoseFromMatrix(rollMatrix)!.roll).toBeCloseTo(15, 4);
  });

  it('returns null for a missing or broken matrix', () => {
    expect(headPoseFromMatrix(undefined)).toBeNull();
    expect(headPoseFromMatrix([1, 2, 3])).toBeNull();
    expect(headPoseFromMatrix(new Array<number>(16).fill(Number.NaN))).toBeNull();
  });
});

describe('pose gating', () => {
  it('accepts a face that is roughly square to the camera', () => {
    expect(isHeadAligned({ yaw: 6, pitch: -4, roll: 3 })).toBe(true);
    expect(poseProblem({ yaw: 6, pitch: -4, roll: 3 })).toBeNull();
  });

  it('rejects a turned, nodding or tilted head and says which', () => {
    expect(poseProblem({ yaw: 25, pitch: 0, roll: 0 })).toBe('turned');
    expect(poseProblem({ yaw: 0, pitch: -30, roll: 0 })).toBe('nodding');
    expect(poseProblem({ yaw: 0, pitch: 0, roll: 40 })).toBe('tilted');
  });

  it('does not block measurement when the pose is unknown', () => {
    expect(isHeadAligned(null)).toBe(true);
  });
});

describe('baseline and repetitions', () => {
  const neutral = repeatFace(20, { mouth: { left: 0.45, right: 0.45 } });

  it('averages the relaxed frames into a baseline', () => {
    const baseline = buildBaseline(neutral, [pucker, smile], CONFIG)!;
    expect(baseline).not.toBeNull();
    expect(baseline.samples).toBe(20);
    expect(baseline.signals['pucker']!.left).toBeCloseTo(0.45, 6);
    expect(baseline.signals['smile-closed']!.left).toBeCloseTo(0.02, 6);
    expect(baseline.blendshapes['eyeBlinkLeft']).toBeCloseTo(0.05, 6);
    expect(baseline.mouthCorners.left.v).toBeCloseTo(0.45, 6);
  });

  it('returns null when no frame was usable', () => {
    expect(buildBaseline([], [pucker], CONFIG)).toBeNull();
  });

  it('scores a pucker rep from how far each corner came in', () => {
    const baseline = buildBaseline(neutral, [pucker], CONFIG)!;
    // Left corner moves 0.10 inwards, right corner 0.05.
    const hold = repeatFace(15, { mouth: { left: 0.35, right: 0.4 } });
    const rep = measureRep(1, hold, pucker, baseline, CONFIG);
    expect(rep.movement.left).toBeCloseTo(0.1, 6);
    expect(rep.movement.right).toBeCloseTo(0.05, 6);
    expect(rep.symmetry.score).toBe(50);
    expect(rep.symmetry.weakerSide).toBe('right');
    expect(rep.samples).toBe(15);
  });

  it('scores a cheek puff rep from the outward bulge of each cheek', () => {
    const relaxed = repeatFace(12, { cheek: { left: 0.95, right: 0.95 } });
    const baseline = buildBaseline(relaxed, [cheekPuff], CONFIG)!;
    const hold = repeatFace(12, { cheek: { left: 1.0, right: 0.975 } });
    const rep = measureRep(1, hold, cheekPuff, baseline, CONFIG);
    expect(rep.movement.left).toBeCloseTo(0.05, 6);
    expect(rep.movement.right).toBeCloseTo(0.025, 6);
    expect(rep.symmetry.score).toBe(50);
  });

  it('refuses to score a rep built from too few frames', () => {
    const baseline = buildBaseline(neutral, [pucker], CONFIG)!;
    const rep = measureRep(1, repeatFace(2, { mouth: { left: 0.3, right: 0.3 } }), pucker, baseline, CONFIG);
    expect(rep.samples).toBe(2);
    expect(rep.symmetry.status).toBe('insufficient');
  });

  it('reports a barely moving rep as unmeasurable rather than symmetric', () => {
    const baseline = buildBaseline(neutral, [pucker], CONFIG)!;
    const hold = repeatFace(15, { mouth: { left: 0.449, right: 0.4485 } });
    const rep = measureRep(1, hold, pucker, baseline, CONFIG);
    expect(rep.symmetry.status).toBe('insufficient');
  });

  it('measures a blendshape exercise straight from the scores', () => {
    const baseline = buildBaseline(neutral, [smile], CONFIG)!;
    const hold = repeatFace(10, { blendshapes: { mouthSmileLeft: 0.42, mouthSmileRight: 0.22 } });
    const rep = measureRep(1, hold, smile, baseline, CONFIG);
    expect(rep.movement.left).toBeCloseTo(0.4, 6);
    expect(rep.movement.right).toBeCloseTo(0.2, 6);
    expect(rep.symmetry.score).toBe(50);
  });

  it('reads the exercise signal for either kind of spec', () => {
    const sample = makeFace({ blendshapes: { mouthSmileLeft: 0.3, mouthSmileRight: 0.1 } });
    const geometry = faceGeometry(sample.landmarks, sample.aspect, CONFIG)!;
    expect(measureSides(smile.signal, sample, geometry, CONFIG)).toEqual({ left: 0.3, right: 0.1 });
    expect(measureSides(pucker.signal, sample, geometry, CONFIG)!.left).toBeCloseTo(0.45, 6);
  });
});

describe('synkinesis', () => {
  const neutral = repeatFace(20);
  const baseline = buildBaseline(neutral, [smile], CONFIG)!;

  it('flags the side whose eye narrows during a smile', () => {
    const hold = repeatFace(10, {
      blendshapes: {
        mouthSmileLeft: 0.4,
        mouthSmileRight: 0.4,
        eyeBlinkLeft: 0.45,
        eyeBlinkRight: 0.06,
      },
    });
    const reps = [1, 2, 3].map((index) => measureRep(index, hold, smile, baseline, CONFIG));
    const findings = findSynkinesis(smile, reps);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.side).toBe('left');
    expect(findings[0]!.magnitude).toBeCloseTo(0.4, 6);
  });

  it('stays quiet when the eyes barely change', () => {
    const hold = repeatFace(10, {
      blendshapes: { mouthSmileLeft: 0.4, mouthSmileRight: 0.4, eyeBlinkLeft: 0.12 },
    });
    const reps = [measureRep(1, hold, smile, baseline, CONFIG)];
    expect(findSynkinesis(smile, reps)).toEqual([]);
  });

  it('stays quiet when the intended movement never happened', () => {
    // A clenched eye with no smile is not evidence of smile synkinesis.
    const hold = repeatFace(10, { blendshapes: { eyeBlinkLeft: 0.9 } });
    const reps = [measureRep(1, hold, smile, baseline, CONFIG)];
    expect(findSynkinesis(smile, reps)).toEqual([]);
  });

  it('flags a mouth corner that moves while the eyes close', () => {
    const eyeClosure = EXERCISES_BY_ID['eye-closure'] as ExerciseDef;
    const relaxed = repeatFace(20, { mouth: { left: 0.45, right: 0.45 } });
    const eyeBaseline = buildBaseline(relaxed, [eyeClosure], CONFIG)!;
    const hold = repeatFace(10, {
      mouth: { left: 0.39, right: 0.45 },
      blendshapes: { eyeBlinkLeft: 0.8, eyeBlinkRight: 0.8 },
    });
    const reps = [measureRep(1, hold, eyeClosure, eyeBaseline, CONFIG)];
    const findings = findSynkinesis(eyeClosure, reps);
    expect(findings.map((finding) => finding.side)).toEqual(['left']);
  });
});

describe('summaries', () => {
  const neutral = repeatFace(20, { mouth: { left: 0.45, right: 0.45 } });
  const baseline = buildBaseline(neutral, [pucker], CONFIG)!;
  const repWith = (left: number, right: number, index = 1) =>
    measureRep(index, repeatFace(10, { mouth: { left, right } }), pucker, baseline, CONFIG);

  it('takes the median rep so one bad rep cannot decide the score', () => {
    const reps = [
      repWith(0.35, 0.4, 1), // 50
      repWith(0.35, 0.375, 2), // 75
      repWith(0.35, 0.35, 3), // 100
      repWith(0.35, 0.4, 4), // 50
      repWith(0.35, 0.35, 5), // 100
    ];
    const result = summariseExercise(pucker, reps);
    expect(reps.map((rep) => rep.symmetry.score)).toEqual([50, 75, 100, 50, 100]);
    expect(result.status).toBe('ok');
    expect(result.score).toBe(75);
    expect(result.validReps).toBe(5);
  });

  it('marks an exercise with no usable reps as insufficient, not as zero', () => {
    const reps = [1, 2, 3].map((index) => repWith(0.4499, 0.4498, index));
    const result = summariseExercise(pucker, reps);
    expect(result.status).toBe('insufficient');
    expect(result.score).toBeNull();
  });

  it('marks an exercise with no reps at all as skipped', () => {
    expect(summariseExercise(pucker, []).status).toBe('skipped');
  });

  it('names the weaker side from the median movement', () => {
    const result = summariseExercise(pucker, [repWith(0.4, 0.3, 1), repWith(0.4, 0.3, 2)]);
    expect(result.weakerSide).toBe('left');
  });

  it('averages only the exercises it could score', () => {
    const scored = summariseExercise(pucker, [repWith(0.35, 0.4, 1)]); // 50
    const unscored = summariseExercise(pucker, []);
    expect(overallScore([scored, unscored])).toBe(50);
    expect(overallScore([unscored])).toBeNull();
    expect(overallScore([])).toBeNull();
  });
});

describe('ema', () => {
  it('starts at the first value and then eases towards new ones', () => {
    expect(ema(null, 0.5, 0.3)).toBe(0.5);
    expect(ema(0, 1, 0.5)).toBeCloseTo(0.5, 6);
    expect(ema(0, 1, 0)).toBe(0);
    expect(ema(0, 1, 1)).toBe(1);
  });

  it('settles on a steady input', () => {
    let value: number | null = null;
    for (let i = 0; i < 100; i += 1) value = ema(value, 0.8, 0.3);
    expect(value).toBeCloseTo(0.8, 6);
  });
});

describe('pose gating against the calibrated neutral', () => {
  it('accepts the pose the user actually holds, even if it is not dead ahead', () => {
    // A camera below eye level gives every frame the same pitch offset.
    const neutral = { yaw: 2, pitch: -18, roll: 1 };
    expect(poseProblem({ yaw: 4, pitch: -20, roll: 2 }, undefined, neutral)).toBeNull();
    // Without the reference the same frame would be rejected.
    expect(poseProblem({ yaw: 4, pitch: -20, roll: 2 })).toBe('nodding');
  });

  it('still rejects a real turn away from that neutral', () => {
    const neutral = { yaw: 2, pitch: -18, roll: 1 };
    expect(poseProblem({ yaw: 30, pitch: -18, roll: 1 }, undefined, neutral)).toBe('turned');
    expect(poseProblem({ yaw: 2, pitch: 5, roll: 1 }, undefined, neutral)).toBe('nodding');
  });

  it('records the neutral pose during calibration', () => {
    const samples = [0, 1, 2].map((index) => ({
      ...makeFace(),
      t: index,
      headPose: { yaw: 2, pitch: -18, roll: 1 },
    }));
    const baseline = buildBaseline(samples, [pucker], CONFIG)!;
    expect(baseline.headPose).toEqual({ yaw: 2, pitch: -18, roll: 1 });
  });
});
