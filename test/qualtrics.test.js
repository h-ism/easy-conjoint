/* Automated tests for the Qualtrics export feature of conjoint.html.
 *
 * Run with:  npm test   (or: node test/qualtrics.test.js)
 *
 * Strategy:
 *   - Load conjoint.html in jsdom to reach the generator functions
 *     (buildQualtricsJS / qualtricsDesign / qualtricsFields) as they run in
 *     the real page.
 *   - Execute the *generated* snippet in a second, clean jsdom window with a
 *     mocked Qualtrics.SurveyEngine API, once per task, to prove runtime
 *     behaviour (embedded data, table rendering, constraints, resume).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

/* ---------------- tiny test harness ---------------- */
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failed++; console.error("  ✗ " + msg); }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg); }

/* ---------------- load the builder page ---------------- */
const html = fs.readFileSync(path.join(__dirname, "..", "conjoint.html"), "utf8");
const builderDom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
const B = builderDom.window;

/* ---------------- sample design (has a blank level + a constraint) ---------------- */
const design = {
  title: "Test conjoint",
  intro: "pick one",
  attributes: [
    { id: "a1", name: "Education", levels: [
      { text: "No formal", weight: 1 },
      { text: "College degree", weight: 1 },
      { text: "", weight: 1 }            /* blank -> must be excluded */
    ] },
    { id: "a2", name: "Profession", levels: [
      { text: "Doctor", weight: 1 },
      { text: "Waiter", weight: 1 }
    ] },
    { id: "a3", name: "Country of origin", levels: [
      { text: "India", weight: 1 },
      { text: "Germany", weight: 1 }
    ] }
  ],
  /* Forbid Profession=Doctor together with Education=No formal */
  constraints: [{ attrA: "a2", levelA: "Doctor", attrB: "a1", levelB: "No formal" }],
  numTasks: 4,
  numProfiles: 2,
  randOrder: true,
  noIdentical: true,
  askRating: false
};

const cj = B.qualtricsDesign(design);
const NT = cj.numTasks, NP = cj.numProfiles, NA = cj.attributes.length;
const code = B.buildQualtricsJS(design);

/* ---------------- mock Qualtrics survey environment ---------------- */
function makeEnv(opts) {
  opts = opts || {};
  const dom = new JSDOM("<!DOCTYPE html><body></body>", {
    runScripts: "outside-only", url: "http://localhost/"
  });
  const w = dom.window;
  const env = { window: w, ED: {}, currentQuestion: null, setCalls: 0, warned: 0, legacyCalls: 0, jsCalls: 0 };
  w.console = Object.assign(Object.create(console), {
    warn: function () { env.warned++; }
  });
  const SE = { addOnload: function (fn) { fn.call(env.currentQuestion); } };
  if (opts.jsApi) {
    /* new response engine: JS API present (preferred) */
    SE.setJSEmbeddedData = function (k, v) { env.ED[k] = String(v); env.setCalls++; env.jsCalls++; };
    SE.getJSEmbeddedData = function (k) {
      return Object.prototype.hasOwnProperty.call(env.ED, k) ? env.ED[k] : null;
    };
  }
  if (opts.jsApi !== "only") {
    /* legacy API: present on old layouts (and, on the new engine, as a
       deprecated no-op we must NOT use when the JS API exists) */
    SE.setEmbeddedData = function (k, v) { env.legacyCalls++; if (!opts.jsApi) { env.ED[k] = String(v); env.setCalls++; } };
    SE.getEmbeddedData = function (k) {
      env.legacyCalls++;
      return Object.prototype.hasOwnProperty.call(env.ED, k) ? env.ED[k] : null;
    };
  }
  w.Qualtrics = { SurveyEngine: SE };
  return env;
}
function runTask(env, taskNum, src) {
  const doc = env.window.document;
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  env.currentQuestion = { getQuestionContainer: function () { return container; } };
  const c = (src || code).replace("var TASK = 1;", "var TASK = " + taskNum + ";");
  env.window.eval(c);
  return container;
}
function headerLabels(container) {
  /* thead th cells after the empty corner cell */
  const ths = Array.prototype.slice.call(container.querySelectorAll("thead th"));
  return ths.slice(1).map(function (th) { return th.textContent; });
}
function attrColumn(container) {
  const rows = Array.prototype.slice.call(container.querySelectorAll("tbody tr"));
  return rows.map(function (r) { return r.querySelector("td").textContent; });
}
function tableText(container) {
  const rows = Array.prototype.slice.call(container.querySelectorAll("tbody tr"));
  return rows.map(function (r) {
    return Array.prototype.slice.call(r.querySelectorAll("td"))
      .map(function (td) { return td.textContent; }).join(" | ");
  }).join("\n");
}
console.log("Sanity: blank level excluded and constraint remapped to indices");
eq(cj.attributes[0].levels.map(function (l) { return l.text; }),
   ["No formal", "College degree"], "  blank level dropped from Education");
eq(cj.constraints, [{ aA: 1, lA: 0, aB: 0, lB: 0 }],
   "  constraint remapped to filtered indices (Doctor idx0 / No formal idx0)");

/* =========================================================
 * (1) generated JS has no syntax errors
 * ========================================================= */
console.log("\n(1) generated snippet compiles");
let syntaxOk = true;
try { new vm.Script(code, { filename: "generated_qualtrics.js" }); }
catch (e) { syntaxOk = false; console.error("    " + e.message); }
ok(syntaxOk, "generated JS parses with no syntax error");

/* =========================================================
 * (2) all tasks -> NT*NP*NA + 1 embedded-data fields
 * ========================================================= */
console.log("\n(2) embedded data field count");
const env2 = makeEnv();
const containers = [];
for (let t = 1; t <= NT; t++) containers.push(runTask(env2, t));
const nKeys = Object.keys(env2.ED).length;
eq(nKeys, NT * NP * NA + 1, "wrote NT*NP*NA + 1 = " + (NT * NP * NA + 1) + " fields");
ok(env2.ED.hasOwnProperty("C_ORDER"), "C_ORDER present");
ok(env2.ED.hasOwnProperty("C_T" + NT + "_P" + NP + "_A" + NA),
   "last cell field C_T" + NT + "_P" + NP + "_A" + NA + " present");

/* =========================================================
 * (3) a table renders every task, attribute row order identical
 * ========================================================= */
console.log("\n(3) table rendering + stable attribute order");
let allTablesPresent = true;
const orders = [];
for (let i = 0; i < containers.length; i++) {
  const tbl = containers[i].querySelector("table.cjoint-table");
  if (!tbl) allTablesPresent = false;
  orders.push(attrColumn(containers[i]));
}
ok(allTablesPresent, "each task rendered a profile table");
let orderStable = true;
for (let i = 1; i < orders.length; i++) {
  if (JSON.stringify(orders[i]) !== JSON.stringify(orders[0])) orderStable = false;
}
ok(orderStable, "attribute row order identical across all tasks");
ok(orders[0].length === NA, "table shows all " + NA + " attribute rows");

/* =========================================================
 * (4) zero constraint violations across the whole plan
 * ========================================================= */
console.log("\n(4) no constraint violations");
function levelIdx(a, txt) {
  const lv = cj.attributes[a].levels;
  for (let i = 0; i < lv.length; i++) if (lv[i].text === txt) return i;
  return -1;
}
let violations = 0;
for (let t = 1; t <= NT; t++) {
  for (let p = 1; p <= NP; p++) {
    const idx = [];
    for (let a = 0; a < NA; a++) idx.push(levelIdx(a, env2.ED["C_T" + t + "_P" + p + "_A" + (a + 1)]));
    cj.constraints.forEach(function (c) {
      if (idx[c.aA] === c.lA && idx[c.aB] === c.lB) violations++;
    });
  }
}
eq(violations, 0, "no forbidden level pairing appears in any profile");

/* =========================================================
 * (5) resume: empty sessionStorage + Embedded Data present ->
 *     same profiles restored, no re-randomization
 * ========================================================= */
console.log("\n(5) resume restores identical profiles without re-drawing");
const env5 = makeEnv();
const first = runTask(env5, 1);
ok(env5.setCalls > 0, "first load populated Embedded Data");
const edSnapshot = JSON.parse(JSON.stringify(env5.ED));
const firstTable = tableText(first);

/* simulate a resumed session: sessionStorage gone, Embedded Data survives */
env5.window.sessionStorage.clear();
env5.setCalls = 0;
const resumed = runTask(env5, 1);
ok(env5.setCalls > 0, "resume re-writes embedded data idempotently (never left empty)");
eq(env5.ED, edSnapshot, "embedded data unchanged after resume (no re-randomization)");
eq(tableText(resumed), firstTable, "resumed table identical to original");

/* also confirm a later task restores consistently in the resumed session */
env5.setCalls = 0;
const resumedT2 = runTask(env5, 2);
ok(resumedT2.querySelector("table.cjoint-table") !== null, "later task also renders after resume");
ok(env5.setCalls > 0, "task 2 also writes embedded data on resume");
eq(env5.ED, edSnapshot, "embedded data still unchanged after task 2");

/* =========================================================
 * (6) 2nd response in the same browser: sessionStorage survives
 *     but Embedded Data is fresh (empty) -> must be re-populated.
 *     Regression guard: loadPlan used to return the cached plan
 *     without ever writing Embedded Data, recording empty data.
 * ========================================================= */
console.log("\n(6) new response reuses cached plan but still writes embedded data");
const env6 = makeEnv();
runTask(env6, 1);                       /* first respondent: populates ED + sessionStorage */
const ed6 = JSON.parse(JSON.stringify(env6.ED));
env6.ED = {};                           /* new Qualtrics response -> fresh, empty ED */
env6.setCalls = 0;
runTask(env6, 1);                       /* sessionStorage still holds the cached plan */
eq(Object.keys(env6.ED).length, NT * NP * NA + 1, "embedded data re-written for the new response");
eq(env6.ED, ed6, "re-written values match the cached plan");

/* =========================================================
 * (7) a stale cached plan that does not match the current design
 *     (profiles shorter than the attribute count) is discarded and
 *     rebuilt instead of crashing writeEmbedded/renderTable.
 * ========================================================= */
console.log("\n(7) mismatched cached plan is discarded, not dereferenced");
const env7 = makeEnv();
const KEY7 = "cjoint_plan_" + NA + "x" + NT + "x" + NP;
const order7 = []; for (let a = 0; a < NA; a++) order7.push(a);
const tasks7 = [];
for (let t = 0; t < NT; t++) {
  const task = [];
  for (let p = 0; p < NP; p++) {
    const prof = []; for (let a = 0; a < NA - 1; a++) prof.push(0); /* too short */
    task.push(prof);
  }
  tasks7.push(task);
}
env7.window.sessionStorage.setItem(KEY7, JSON.stringify({ order: order7, tasks: tasks7 }));
let threw7 = false, cont7 = null;
try { cont7 = runTask(env7, 1); } catch (e) { threw7 = true; }
ok(!threw7, "stale/mismatched cached plan does not crash");
eq(Object.keys(env7.ED).length, NT * NP * NA + 1, "mismatched plan discarded -> fresh plan written");
ok(cont7 && cont7.querySelector("table.cjoint-table") !== null, "table still renders after discarding stale plan");

/* =========================================================
 * (8) new response engine: prefer setJSEmbeddedData/getJSEmbeddedData
 *     over the deprecated set/getEmbeddedData (which no longer saves).
 * ========================================================= */
console.log("\n(8) prefers the JS Embedded Data API when present");
const env8 = makeEnv({ jsApi: true });   /* both APIs exposed; JS preferred */
const cont8 = runTask(env8, 1);
eq(Object.keys(env8.ED).length, NT * NP * NA + 1, "JS API path populates embedded data");
ok(env8.jsCalls > 0, "used setJSEmbeddedData");
eq(env8.legacyCalls, 0, "did not touch deprecated set/getEmbeddedData when JS API exists");
ok(cont8.querySelector("table.cjoint-table") !== null, "table renders under new engine");

/* and the snippet still works when ONLY the JS API is present */
const env8b = makeEnv({ jsApi: "only" });
runTask(env8b, 1);
eq(Object.keys(env8b.ED).length, NT * NP * NA + 1, "works with JS API only (no legacy methods)");

/* =========================================================
 * (9) profile labels with Japanese / quotes / angle brackets:
 *     generated JS still parses and headers escape correctly.
 * ========================================================= */
console.log("\n(9) profile labels escape safely in the table header");
const trickyLabels = ['候補者 "A" <甲>', 'B & <乙>'];
const designL = Object.assign({}, design, { profileLabels: trickyLabels });
const codeL = B.buildQualtricsJS(designL);
let syntaxL = true;
try { new vm.Script(codeL, { filename: "labels.js" }); }
catch (e) { syntaxL = false; console.error("    " + e.message); }
ok(syntaxL, "generated JS with tricky labels parses (no syntax error)");
const envL = makeEnv();
const contL = runTask(envL, 1, codeL);
eq(headerLabels(contL), trickyLabels, "header cells render the exact labels (escaped, not broken markup)");

/* =========================================================
 * (10) design.json snapshot re-imports with labels intact.
 * ========================================================= */
console.log("\n(10) design.json round-trips through Import JSON");
const snapshot = B.buildDesignSnapshot(designL);
const parsed = JSON.parse(snapshot);
const reimported = Object.assign(B.blankDesign(), parsed);   /* Import JSON logic */
eq(reimported.profileLabels, trickyLabels, "profile labels restored from design.json");
eq(reimported.attributes.map(function (a) { return a.name; }),
   design.attributes.map(function (a) { return a.name; }), "attributes restored from design.json");
eq(reimported.numTasks, NT, "numTasks restored from design.json");

/* =========================================================
 * (11) bundle has 9 files; fields.txt line count matches.
 * ========================================================= */
console.log("\n(11) export bundle: 9 files, correct field-list length");
const bundle = B.buildQualtricsBundle(design);
eq(bundle.length, 9, "bundle contains exactly 9 files");
const names = bundle.map(function (f) { return f.name; });
["_qualtrics.js", "_qualtrics_fields.txt", "_qualtrics_setup_ja.md", "_qualtrics_setup_en.md",
 "_codebook_ja.md", "_codebook_en.md", "_ethics_annex_ja.md", "_ethics_annex_en.md"].forEach(function (suf) {
  ok(names.some(function (n) { return n.indexOf(suf) !== -1; }), "bundle includes *" + suf);
});
ok(names.indexOf("design.json") !== -1, "bundle includes design.json");
const fieldsFile = bundle.find(function (f) { return /_fields\.txt$/.test(f.name); });
const fieldLines = fieldsFile.content.split("\n");
eq(fieldLines.length, NT * NP * NA + 1, "fields.txt has NT*NP*NA + 1 lines");
ok(fieldLines.every(function (l) { return l.indexOf("__js_") === 0; }), "every field line is __js_-prefixed");
ok(fieldLines.indexOf("__js_C_ORDER") !== -1, "fields.txt includes __js_C_ORDER");
ok(fieldLines.indexOf("__js_C_T" + NT + "_P" + NP + "_A" + NA) !== -1, "fields.txt includes the last cell field");

/* =========================================================
 * (12) JSZip-unavailable fallback downloads every file.
 * ========================================================= */
console.log("\n(12) fallback downloads each file individually when ZIP is unavailable");
const dlNames = [];
const origDl = B.downloadFile, origST = B.setTimeout;
B.downloadFile = function (n) { dlNames.push(n); };
B.setTimeout = function (fn) { fn(); return 0; };   /* run staggered timers synchronously */
try { B.downloadBundleIndividually(bundle); }
finally { B.downloadFile = origDl; B.setTimeout = origST; }
eq(dlNames.length, 9, "fallback downloaded all 9 files");
eq(dlNames.slice().sort(), names.slice().sort(), "fallback downloaded exactly the bundle files");

/* =========================================================
 * (13) export validation blocks unusable designs.
 * ========================================================= */
console.log("\n(13) export validation catches empty/degenerate designs");
eq(B.qualtricsExportProblems(design), [], "valid design has no problems");
eq(B.qualtricsExportProblems({ attributes: [] }).length, 1, "no attributes -> one problem");
const noLevels = { attributes: [
  { name: "Empty", levels: [{ text: "", weight: 1 }, { text: "  ", weight: 1 }] },
  { name: "Fine", levels: [{ text: "a", weight: 1 }, { text: "b", weight: 1 }] }
] };
const p1 = B.qualtricsExportProblems(noLevels);
eq(p1.length, 1, "attribute with no non-empty levels -> one problem");
ok(/no non-empty levels/.test(p1[0]) && /Empty/.test(p1[0]), "problem names the empty attribute");
const oneLevel = { attributes: [
  { name: "Single", levels: [{ text: "only", weight: 1 }, { text: "", weight: 1 }] }
] };
const p2 = B.qualtricsExportProblems(oneLevel);
eq(p2.length, 1, "attribute with a single usable level -> one problem");
ok(/only one usable level/.test(p2[0]), "problem explains the single-level issue");
const twoBad = { attributes: [
  { name: "", levels: [] },
  { name: "X", levels: [{ text: "a", weight: 1 }] }
] };
eq(B.qualtricsExportProblems(twoBad).length, 2, "multiple bad attributes -> multiple problems");

/* =========================================================
 * results
 * ========================================================= */
console.log("\n----------------------------------------");
console.log("passed: " + passed + "   failed: " + failed);
if (failed > 0) process.exit(1);
console.log("ALL TESTS PASSED");
