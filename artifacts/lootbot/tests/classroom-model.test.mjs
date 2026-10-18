import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../../..");
const { build } = createRequire(
  path.join(root, "artifacts/api-server/package.json"),
)("esbuild");
const directory = path.join(root, "artifacts/lootbot/test-results/classroom");
await mkdir(directory, { recursive: true });
async function bundle(file) {
  const output = path.join(directory, file + ".mjs");
  await build({
    entryPoints: [path.join(root, "artifacts/lootbot/src/lib", file + ".ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  try {
    return await import(pathToFileURL(output).href);
  } finally {
    await unlink(output);
  }
}
const engine = await bundle("classroom-projector-sync"),
  content = await bundle("classroom-game-content");
test("name wheel pointer lands on the selected student in a stable roster order", () => {
  const rows = [
      { id: "3", name: "ب", points: 100 },
      { id: "2", name: "أ", points: 0 },
      { id: "1", name: "أ", points: 5 },
    ],
    order = engine.classroomWheelRoster(rows);
  assert.deepEqual(
    order.map((r) => r.id),
    ["1", "2", "3"],
  );
  assert.equal(rows[0].id, "3");
  for (const count of [1, 2, 3, 5, 6, 23])
    for (let index = 0; index < count; index++) {
      const rotation = engine.wheelSpinRotation(1234, index, count),
        target = (360 - (index * 360) / count) % 360;
      assert.ok(rotation >= 1234 + 1080);
      assert.ok(Math.abs((rotation % 360) - target) < 1e-8);
    }
});
test("car bump movement stays within five bumps and the finish line", () => {
  assert.equal(engine.carRaceMove(1, false), 1);
  assert.equal(engine.carRaceMove(3, false), 2);
  let p = 1;
  for (let i = 0; i < 5; i++) p = engine.carRaceMove(p, true);
  assert.equal(p, 6);
  assert.equal(engine.carRaceMove(6, true), 6);
});
test("ladder movement clamps below zero and above five", () => {
  assert.equal(engine.ladderMove(0, -1), 0);
  assert.equal(engine.ladderMove(3, 1), 4);
  assert.equal(engine.ladderMove(5, 1), 5);
});
test("timers use absolute deadlines and survive delayed callbacks", () => {
  assert.equal(engine.classroomRemaining(9000, 60, 10000), 0);
  assert.equal(engine.classroomRemaining(13001, 60, 10000), 4);
  assert.equal(engine.classroomRemaining(null, 30, 10000), 30);
});
test("public projection excludes hints, unknown private fields and unrevealed answer keys", () => {
  const s = engine.initialClassroomState();
  s.privatePassword = "never-broadcast";
  s.hotSeat.currentWord = {
    id: "w",
    word: "كلمة",
    subject: "مادة",
    unit: "وحدة",
    hint: "private-hint",
  };
  for (const game of ["carRace", "ladderRace", "teamQuiz"])
    s[game].currentQuestion = {
      id: "q",
      text: "سؤال",
      options: ["أ", "ب"],
      revealedAnswer: false,
      correctIndex: 1,
      teacherNote: "private-answer",
    };
  const p = engine.publicClassroomState(s);
  const serialized = JSON.stringify(p);
  for (const privateText of [
    "private-hint",
    "private-answer",
    "never-broadcast",
    "correctIndex",
  ])
    assert.equal(serialized.includes(privateText), false);
  assert.equal(s.carRace.currentQuestion.correctIndex, 1);
  p.carRace.currentQuestion.revealedAnswer = true;
  p.carRace.currentQuestion.correctIndex = 1;
  assert.equal(
    engine.publicClassroomState(p).carRace.currentQuestion.correctIndex,
    1,
  );
});
test("invalid saved state, nonfinite values and malformed projector records are rejected", () => {
  const s = engine.initialClassroomState();
  assert.ok(engine.validClassroomState(s));
  for (const bad of [
    null,
    {},
    { ...s, timer: null },
    { ...s, updatedAt: NaN },
    { ...s, carRace: { ...s.carRace, currentBump: 99 } },
    { ...s, voting: { ...s.voting, options: [null] } },
  ])
    assert.equal(engine.validClassroomState(bad), false);
});
test("original question bank has six subjects, distinct choices and valid answer keys", () => {
  assert.equal(new Set(content.starterWords.map((w) => w.subject)).size, 6);
  assert.equal(content.starterWords.length, 36);
  assert.ok(content.starterQuestions.length >= 40);
  for (const q of content.starterQuestions) {
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4);
    assert.ok(q.correctIndex >= 0 && q.correctIndex < 4);
    assert.equal(q.origin, "starter");
  }
});
test("custom and saved lesson words preserve only authored hints", () => {
  const words = content.customWords("التبخر | تلميح مكتوب\nكلمة بلا شرح");
  assert.equal(words.length, 2);
  assert.equal(words[0].hint, "تلميح مكتوب");
  assert.equal(words[1].hint, "");
  const saved = content.wordsFromLesson({
    id: "lesson",
    title: "تحضيري",
    content: "كلمة | شرح المعلم",
    objectives: "كلمة أخرى",
  });
  assert.equal(saved[0].hint, "شرح المعلم");
  assert.equal(saved[1].hint, "");
});
