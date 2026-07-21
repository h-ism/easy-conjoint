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
function makeEnv() {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", {
    runScripts: "outside-only", url: "http://localhost/"
  });
  const w = dom.window;
  const env = { window: w, ED: {}, currentQuestion: null, setCalls: 0, warned: 0 };
  w.console = Object.assign(Object.create(console), {
    warn: function () { env.warned++; }
  });
  w.Qualtrics = { SurveyEngine: {
    addOnload: function (fn) { fn.call(env.currentQuestion); },
    setEmbeddedData: function (k, v) { env.ED[k] = String(v); env.setCalls++; },
    getEmbeddedData: function (k) {
      return Object.prototype.hasOwnProperty.call(env.ED, k) ? env.ED[k] : null;
    }
  } };
  return env;
}
function runTask(env, taskNum) {
  const doc = env.window.document;
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  env.currentQuestion = { getQuestionContainer: function () { return container; } };
  const c = code.replace("var TASK = 1;", "var TASK = " + taskNum + ";");
  env.window.eval(c);
  return container;
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
 * results
 * ========================================================= */
console.log("\n----------------------------------------");
console.log("passed: " + passed + "   failed: " + failed);
if (failed > 0) process.exit(1);
console.log("ALL TESTS PASSED");
