const { test } = require("node:test");
const assert = require("node:assert/strict");
const support = require("../support.js");

test("negative states get practical resources, including mixed and negated-positive language", () => {
  for (const text of ["我今天不开心", "最近状态不太好", "我的心情很差", "虽然完成了任务，但我还是难过", "今天好累"]) {
    assert.equal(support.analyze(text).distressed, true, text);
    assert.equal(support.recommend(text).length, 2, text);
  }
});
test("ordinary positive, neutral and commonly negated distress do not recommend", () => {
  for (const text of ["今天很开心", "我完成了任务", "你好", "今天没有压力", "我不焦虑了", "已经不再难过", "最近不怎么累", "我压力不大"]) {
    assert.deepEqual(support.recommend(text), [], text);
  }
});
test("recommendations follow the expressed difficulty", () => {
  assert.deepEqual(support.recommend("我有点焦虑，压力很大"), ["breathing", "grounding"]);
  assert.deepEqual(support.recommend("我睡不着"), ["sleep", "music"]);
  assert.deepEqual(support.recommend("工作好累"), ["music", "breathing"]);
  assert.deepEqual(support.recommend("我很孤独"), ["music", "grounding"]);
});
test("respect listening preferences and explicit refusal", () => {
  for (const mode of ["quiet", "no-advice"]) assert.deepEqual(support.recommend("很难过", mode), []);
  assert.deepEqual(support.recommend("很难过，但不要推荐链接"), []);
  assert.deepEqual(support.recommend("很难过，不想听音乐"), []);
  assert.equal(support.recommend("很难过", "observer").length, 2);
  assert.equal(support.recommend("很难过", "gentle").length, 2);
});
test("crisis support takes precedence over music and relaxation", () => {
  for (const text of ["焦虑得不想活了", "想伤害自己", "想一了百了", "不想再醒来"]) {
    assert.equal(support.analyze(text).crisis, true);
    assert.deepEqual(support.recommend(text), []);
  }
});
test("only curated destinations can be restored from local history", () => {
  assert.deepEqual(support.validIds(["javascript:alert(1)", "__proto__", "music", "music", "sleep", "breathing"]), ["music", "sleep"]);
  assert.deepEqual(support.validIds(null), []);
  for (const resource of Object.values(support.resources)) assert.match(resource.href, /^relax\.html\?activity=(music|breathing|grounding|sleep)$/);
});
