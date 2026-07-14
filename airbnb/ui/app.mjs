const STORAGE_KEY = "apple-pay-analytics-lab:v1";
const STORAGE_VERSION = 1;

const elements = Object.fromEntries(
  [
    "server-state",
    "progress-label",
    "progress-percent",
    "progress-bar",
    "lesson-list",
    "reset-progress",
    "learn-mode",
    "explore-mode",
    "open-catalog",
    "lesson-panel",
    "lesson-kicker",
    "lesson-title",
    "lesson-duration",
    "lesson-objective",
    "lesson-concept",
    "lesson-task",
    "lesson-model-path",
    "hint-box",
    "lesson-hints",
    "load-starter",
    "show-solution",
    "playground-intro",
    "query-example",
    "row-limit",
    "workspace-title",
    "sql-editor",
    "run-query",
    "feedback",
    "results-meta",
    "empty-results",
    "empty-results-message",
    "table-scroll",
    "results-head",
    "results-body",
    "lesson-pagination",
    "previous-lesson",
    "next-lesson",
    "catalog-dialog",
    "close-catalog",
    "catalog-filter",
    "catalog-list"
  ].map((id) => [id, document.getElementById(id)])
);

let course = null;
let saveTimer = null;
let state = readState();

function defaultState() {
  return {
    version: STORAGE_VERSION,
    activeLesson: null,
    mode: "learn",
    completed: [],
    drafts: {},
    playgroundSql: "SELECT *\nFROM mart_apple_pay_daily_performance\nORDER BY transaction_date, currency, payment_channel;"
  };
}

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (
      saved?.version !== STORAGE_VERSION ||
      !Array.isArray(saved.completed) ||
      !saved.drafts ||
      typeof saved.drafts !== "object"
    ) {
      return defaultState();
    }
    return {
      ...defaultState(),
      ...saved,
      mode: saved.mode === "explore" ? "explore" : "learn",
      completed: saved.completed.filter((item) => typeof item === "string"),
      drafts: Object.fromEntries(
        Object.entries(saved.drafts).filter(
          ([key, value]) => typeof key === "string" && typeof value === "string"
        )
      )
    };
  } catch {
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    showFeedback("Your browser blocked progress storage. The lab still works for this session.", "error");
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 250);
}

function activeLesson() {
  return course?.lessons.find((lesson) => lesson.id === state.activeLesson) ?? course?.lessons[0];
}

function rememberEditor() {
  if (!course) return;
  if (state.mode === "learn") {
    const lesson = activeLesson();
    if (lesson) state.drafts[lesson.id] = elements["sql-editor"].value;
  } else {
    state.playgroundSql = elements["sql-editor"].value;
  }
}

function lessonSql(lesson) {
  return state.drafts[lesson.id] ?? lesson.starterSql;
}

function showFeedback(message, type = "info") {
  const feedback = elements.feedback;
  feedback.classList.toggle("is-success", type === "success");
  feedback.classList.toggle("is-error", type === "error");
  feedback.textContent = message;
}

function clearFeedback() {
  elements.feedback.textContent = "";
  elements.feedback.classList.remove("is-success", "is-error");
}

function renderProgress() {
  const validIds = new Set(course.lessons.map((lesson) => lesson.id));
  const completedCount = new Set(state.completed.filter((id) => validIds.has(id))).size;
  const percent = Math.round((completedCount / course.lessons.length) * 100);
  elements["progress-label"].textContent = `${completedCount} of ${course.lessons.length} complete`;
  elements["progress-percent"].textContent = `${percent}%`;
  elements["progress-bar"].max = course.lessons.length;
  elements["progress-bar"].value = completedCount;
  elements["progress-bar"].setAttribute("aria-valuetext", `${completedCount} of ${course.lessons.length} lessons complete`);
}

function renderLessonNavigation() {
  const completed = new Set(state.completed);
  const items = course.lessons.map((lesson) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const number = document.createElement("span");
    const title = document.createElement("span");
    const mark = document.createElement("span");

    button.type = "button";
    button.className = "lesson-nav-button";
    button.dataset.lessonId = lesson.id;
    button.setAttribute("aria-label", `Lesson ${lesson.number}: ${lesson.title}${completed.has(lesson.id) ? ", complete" : ""}`);
    if (state.mode === "learn" && lesson.id === state.activeLesson) {
      button.setAttribute("aria-current", "step");
    }
    if (completed.has(lesson.id)) button.classList.add("is-complete");

    number.className = "lesson-number";
    number.textContent = completed.has(lesson.id) ? "✓" : String(lesson.number).padStart(2, "0");
    number.setAttribute("aria-hidden", "true");
    title.className = "lesson-nav-title";
    title.textContent = lesson.title;
    mark.className = "completion-mark";
    mark.textContent = completed.has(lesson.id) ? "✓" : "";
    mark.setAttribute("aria-hidden", "true");

    button.append(number, title, mark);
    button.addEventListener("click", () => selectLesson(lesson.id));
    item.append(button);
    return item;
  });
  elements["lesson-list"].replaceChildren(...items);
}

function renderLesson() {
  const lesson = activeLesson();
  if (!lesson) return;
  const index = course.lessons.indexOf(lesson);
  state.activeLesson = lesson.id;

  elements["lesson-kicker"].textContent = `Lesson ${lesson.number} of ${course.lessons.length}`;
  elements["lesson-title"].textContent = lesson.title;
  elements["lesson-duration"].textContent = lesson.duration;
  elements["lesson-objective"].textContent = lesson.objective;
  elements["lesson-concept"].textContent = lesson.concept;
  elements["lesson-task"].textContent = lesson.task;
  elements["lesson-model-path"].textContent = lesson.modelPath;
  elements["hint-box"].open = false;

  const hints = lesson.hints.map((hint) => {
    const item = document.createElement("li");
    item.textContent = hint;
    return item;
  });
  elements["lesson-hints"].replaceChildren(...hints);
  elements["sql-editor"].value = lessonSql(lesson);

  elements["previous-lesson"].disabled = index === 0;
  elements["next-lesson"].disabled = index === course.lessons.length - 1;
  elements["next-lesson"].textContent = index === course.lessons.length - 1 ? "Final lesson" : "Next lesson →";
}

function renderMode() {
  const learning = state.mode === "learn";
  elements["learn-mode"].classList.toggle("is-active", learning);
  elements["explore-mode"].classList.toggle("is-active", !learning);
  elements["learn-mode"].setAttribute("aria-pressed", String(learning));
  elements["explore-mode"].setAttribute("aria-pressed", String(!learning));
  elements["lesson-panel"].hidden = !learning;
  elements["lesson-pagination"].hidden = !learning;
  elements["playground-intro"].hidden = learning;
  elements["workspace-title"].textContent = learning ? "Lesson SQL editor" : "SQL editor";

  if (learning) renderLesson();
  else elements["sql-editor"].value = state.playgroundSql;
  renderLessonNavigation();
}

function setMode(mode) {
  if (!course || state.mode === mode) return;
  rememberEditor();
  state.mode = mode;
  clearFeedback();
  renderMode();
  saveState();
}

function selectLesson(lessonId) {
  if (!course.lessons.some((lesson) => lesson.id === lessonId)) return;
  rememberEditor();
  state.activeLesson = lessonId;
  state.mode = "learn";
  clearFeedback();
  renderMode();
  saveState();
  elements["lesson-title"].focus?.();
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  document.getElementById("main-content").scrollIntoView({ behavior, block: "start" });
}

function moveLesson(offset) {
  if (!course) return;
  const index = course.lessons.findIndex((lesson) => lesson.id === state.activeLesson);
  const target = course.lessons[index + offset];
  if (target) selectLesson(target.id);
}

function renderExamples() {
  const options = course.examples.map((example) => {
    const option = document.createElement("option");
    option.value = example.id;
    option.textContent = example.description;
    return option;
  });
  elements["query-example"].append(...options);
}

function catalogItem(relation) {
  const item = document.createElement("article");
  const copy = document.createElement("div");
  const name = document.createElement("code");
  const detail = document.createElement("p");
  const action = document.createElement("button");
  const badge = document.createElement("span");

  item.className = "catalog-item";
  item.dataset.search = `${relation.name} ${relation.layer} ${relation.grain} ${relation.columns.join(" ")}`.toLowerCase();
  name.textContent = relation.name;
  detail.textContent = `${relation.rows} rows · ${relation.grain} · ${relation.columns.length} columns`;
  badge.className = "layer-badge";
  badge.textContent = relation.layer;
  action.type = "button";
  action.className = "secondary-button";
  action.textContent = "Preview";
  action.setAttribute("aria-label", `Preview ${relation.name}`);
  action.addEventListener("click", () => {
    rememberEditor();
    state.mode = "explore";
    state.playgroundSql = `SELECT *\nFROM ${relation.name}\nLIMIT 20;`;
    renderMode();
    saveState();
    elements["catalog-dialog"].close();
    elements["sql-editor"].focus();
  });

  copy.append(name, detail);
  item.append(copy, badge, action);
  return item;
}

function renderCatalog(filter = "") {
  const needle = filter.trim().toLowerCase();
  const relations = course.catalog.filter((relation) =>
    `${relation.name} ${relation.layer} ${relation.grain} ${relation.columns.join(" ")}`.toLowerCase().includes(needle)
  );
  elements["catalog-list"].replaceChildren(...relations.map(catalogItem));
}

function renderResults(result) {
  const headerRow = document.createElement("tr");
  for (const column of result.columns) {
    const heading = document.createElement("th");
    heading.scope = "col";
    heading.textContent = column;
    headerRow.append(heading);
  }

  const bodyRows = result.rows.map((row) => {
    const tableRow = document.createElement("tr");
    for (const column of result.columns) {
      const cell = document.createElement("td");
      const value = row[column];
      cell.textContent = value == null ? "NULL" : String(value);
      if (value == null) cell.className = "null-value";
      tableRow.append(cell);
    }
    return tableRow;
  });

  elements["results-head"].replaceChildren(headerRow);
  elements["results-body"].replaceChildren(...bodyRows);
  elements["empty-results-message"].textContent = "The query returned no columns.";
  elements["empty-results"].hidden = result.columns.length > 0;
  elements["table-scroll"].hidden = result.columns.length === 0;
  const truncation = result.truncated ? ` · capped at ${result.limit}` : "";
  elements["results-meta"].textContent = `${result.rowCount} row${result.rowCount === 1 ? "" : "s"} · ${result.durationMs} ms${truncation}`;
}

function clearResultsAfterError() {
  elements["results-head"].replaceChildren();
  elements["results-body"].replaceChildren();
  elements["empty-results-message"].textContent = "Fix the query and run it again.";
  elements["empty-results"].hidden = false;
  elements["table-scroll"].hidden = true;
}

async function runQuery() {
  if (!course || elements["run-query"].disabled) return;
  const sql = elements["sql-editor"].value.trim();
  if (!sql) {
    showFeedback("Write a SELECT or WITH query before running it.", "error");
    elements["sql-editor"].focus();
    return;
  }

  rememberEditor();
  saveState();
  clearFeedback();
  const submittedMode = state.mode;
  const submittedLessonId = submittedMode === "learn" ? state.activeLesson : null;
  elements["run-query"].disabled = true;
  elements["run-query"].textContent = "Running…";
  elements["results-meta"].textContent = "Running query…";

  try {
    const payload = {
      sql,
      limit: Number(elements["row-limit"].value)
    };
    if (submittedLessonId) payload.lessonId = submittedLessonId;

    const response = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({ error: "The server returned an unreadable response." }));
    if (!response.ok) throw new Error(result.error ?? `Query failed with HTTP ${response.status}.`);

    renderResults(result);
    if (submittedMode === "learn" && submittedLessonId && result.lessonCheck) {
      if (result.lessonCheck.passed) {
        if (!state.completed.includes(submittedLessonId)) state.completed.push(submittedLessonId);
        showFeedback(result.lessonCheck.message, "success");
        renderProgress();
        renderLessonNavigation();
        saveState();
      } else {
        showFeedback(result.lessonCheck.message, "info");
      }
    } else {
      showFeedback(`Query finished successfully with ${result.rowCount} row${result.rowCount === 1 ? "" : "s"}.`, "success");
    }
  } catch (error) {
    clearResultsAfterError();
    elements["results-meta"].textContent = "Query did not run.";
    showFeedback(error.message || "The query could not be completed.", "error");
  } finally {
    elements["run-query"].disabled = false;
    elements["run-query"].replaceChildren(document.createTextNode("▶ Run query"));
  }
}

function resetStarter() {
  const lesson = activeLesson();
  if (!lesson) return;
  if (elements["sql-editor"].value !== lesson.starterSql && !window.confirm("Replace your current query with the starter SQL?")) return;
  state.drafts[lesson.id] = lesson.starterSql;
  elements["sql-editor"].value = lesson.starterSql;
  clearFeedback();
  saveState();
  elements["sql-editor"].focus();
}

function showSolution() {
  const lesson = activeLesson();
  if (!lesson) return;
  if (!window.confirm("Load the solution into the editor? You will still need to run it to complete the lesson.")) return;
  state.drafts[lesson.id] = lesson.solutionSql;
  elements["sql-editor"].value = lesson.solutionSql;
  showFeedback("Solution loaded. Run it to check the result; loading it does not mark the lesson complete.");
  saveState();
  elements["sql-editor"].focus();
}

function resetProgress() {
  if (!course) return;
  if (!window.confirm("Reset all lesson progress and saved SQL drafts? This cannot be undone.")) return;
  const firstLessonId = course.lessons[0].id;
  state = { ...defaultState(), activeLesson: firstLessonId };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The in-memory reset still works when a privacy setting blocks storage.
  }
  clearFeedback();
  renderProgress();
  renderMode();
  saveState();
}

function bindEvents() {
  elements["learn-mode"].addEventListener("click", () => setMode("learn"));
  elements["explore-mode"].addEventListener("click", () => setMode("explore"));
  elements["previous-lesson"].addEventListener("click", () => moveLesson(-1));
  elements["next-lesson"].addEventListener("click", () => moveLesson(1));
  elements["load-starter"].addEventListener("click", resetStarter);
  elements["show-solution"].addEventListener("click", showSolution);
  elements["reset-progress"].addEventListener("click", resetProgress);
  elements["run-query"].addEventListener("click", runQuery);
  elements["sql-editor"].addEventListener("input", () => {
    rememberEditor();
    scheduleSave();
  });
  elements["sql-editor"].addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void runQuery();
    }
  });
  elements["query-example"].addEventListener("change", (event) => {
    if (!course) return;
    const example = course.examples.find((item) => item.id === event.target.value);
    if (!example) return;
    state.playgroundSql = example.sql;
    elements["sql-editor"].value = example.sql;
    saveState();
    elements["sql-editor"].focus();
  });
  elements["open-catalog"].addEventListener("click", () => {
    if (!course) return;
    elements["catalog-filter"].value = "";
    renderCatalog();
    elements["catalog-dialog"].showModal();
    elements["catalog-filter"].focus();
  });
  elements["close-catalog"].addEventListener("click", () => elements["catalog-dialog"].close());
  elements["catalog-filter"].addEventListener("input", (event) => renderCatalog(event.target.value));
  elements["catalog-dialog"].addEventListener("click", (event) => {
    if (event.target === elements["catalog-dialog"]) elements["catalog-dialog"].close();
  });
}

async function initialize() {
  bindEvents();
  try {
    const response = await fetch("/api/bootstrap", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Server returned HTTP ${response.status}.`);
    course = await response.json();
    if (!Array.isArray(course.lessons) || course.lessons.length !== 10) {
      throw new Error("The course did not load all 10 lessons.");
    }

    if (!course.lessons.some((lesson) => lesson.id === state.activeLesson)) {
      state.activeLesson = course.lessons[0].id;
    }
    state.completed = state.completed.filter((id) => course.lessons.some((lesson) => lesson.id === id));
    elements["server-state"].classList.add("is-online");
    elements["server-state"].replaceChildren(
      Object.assign(document.createElement("span"), { className: "status-dot" }),
      document.createTextNode("Local lab online")
    );
    elements["server-state"].firstElementChild.setAttribute("aria-hidden", "true");
    renderExamples();
    renderProgress();
    renderCatalog();
    renderMode();
    saveState();
  } catch (error) {
    elements["server-state"].classList.add("is-error");
    elements["server-state"].replaceChildren(
      Object.assign(document.createElement("span"), { className: "status-dot" }),
      document.createTextNode("Lab unavailable")
    );
    elements["server-state"].firstElementChild.setAttribute("aria-hidden", "true");
    elements["run-query"].disabled = true;
    showFeedback(`Could not load the local learning lab: ${error.message}`, "error");
  }
}

void initialize();
