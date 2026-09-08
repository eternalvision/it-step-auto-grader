(() => {
  "use strict";

  /*
   * The script deliberately keeps the platform selectors here.  They are the
   * small, stable contract with the current Angular application.
   */
  const SELECTORS = Object.freeze({
    forms: "app-homework-review form[novalidate]",
    gradeButtons: "mat-button-toggle button",
    gradeLabel: ".mat-button-toggle-label-content",
    comment: 'textarea[formcontrolname="coment"]',
  });

  const DEFAULT_SETTINGS = Object.freeze({
    minGrade: 9,
    maxGrade: 12,
    autoComment: "good",
    maxFailures: 5,
    dryRun: false,
    strategy: "random",
    maxWaitTime: 20_000,
    maxWaitFormReady: 15_000,
    maxWaitAccept: 5_000,
    maxWaitSubmit: 10_000,
    pollInterval: 100,
    nextFormPollInterval: 300,
  });

  const SETTINGS_KEY = "step-auto-grader:settings";
  const HISTORY_KEY = "step-auto-grader:history";
  const MAX_HISTORY = 20;
  const STOPPED = Symbol("stopped");
  const ALLOWED_STRATEGIES = new Set(["random", "preferred-low", "preferred-high"]);

  const state = {
    settings: loadSettings(),
    running: false,
    status: "idle",
    stopRequested: false,
    runContext: null,
    runPromise: null,
    stats: createStats(),
    history: loadHistory(),
    panel: null,
    observer: null,
    updateScheduled: false,
  };

  function createStats() {
    return {
      total: 0,
      success: 0,
      skipped: 0,
      failures: 0,
      previews: 0,
      stopped: false,
      gradeCounts: {},
      errors: {},
    };
  }

  function safeInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function safeString(value, fallback, maxLength = 500) {
    return typeof value === "string" ? value.slice(0, maxLength) : fallback;
  }

  function normalizeSettings(value = {}) {
    const minGrade = safeInteger(value.minGrade, DEFAULT_SETTINGS.minGrade, 0, 100);
    const maxGrade = safeInteger(value.maxGrade, DEFAULT_SETTINGS.maxGrade, 0, 100);

    return {
      ...DEFAULT_SETTINGS,
      minGrade: Math.min(minGrade, maxGrade),
      maxGrade: Math.max(minGrade, maxGrade),
      autoComment: safeString(value.autoComment, DEFAULT_SETTINGS.autoComment, 1_000),
      maxFailures: safeInteger(value.maxFailures, DEFAULT_SETTINGS.maxFailures, 1, 100),
      dryRun: value.dryRun === true,
      strategy: ALLOWED_STRATEGIES.has(value.strategy) ? value.strategy : DEFAULT_SETTINGS.strategy,
      maxWaitTime: safeInteger(value.maxWaitTime, DEFAULT_SETTINGS.maxWaitTime, 1, 120_000),
      maxWaitFormReady: safeInteger(value.maxWaitFormReady, DEFAULT_SETTINGS.maxWaitFormReady, 1, 120_000),
      maxWaitAccept: safeInteger(value.maxWaitAccept, DEFAULT_SETTINGS.maxWaitAccept, 1, 120_000),
      maxWaitSubmit: safeInteger(value.maxWaitSubmit, DEFAULT_SETTINGS.maxWaitSubmit, 1, 120_000),
      pollInterval: safeInteger(value.pollInterval, DEFAULT_SETTINGS.pollInterval, 1, 10_000),
      nextFormPollInterval: safeInteger(
        value.nextFormPollInterval,
        DEFAULT_SETTINGS.nextFormPollInterval,
        1,
        10_000
      ),
    };
  }

  function loadSettings() {
    try {
      const stored = window.localStorage.getItem(SETTINGS_KEY);
      return stored ? normalizeSettings(JSON.parse(stored)) : normalizeSettings();
    } catch (error) {
      console.warn("[step-auto-grader] Не удалось прочитать настройки:", error);
      return normalizeSettings();
    }
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (error) {
      console.warn("[step-auto-grader] Не удалось сохранить настройки:", error);
    }
  }

  function loadHistory() {
    try {
      const stored = window.localStorage.getItem(HISTORY_KEY);
      const history = stored ? JSON.parse(stored) : [];
      return Array.isArray(history) ? history.slice(0, MAX_HISTORY) : [];
    } catch (error) {
      console.warn("[step-auto-grader] Не удалось прочитать историю:", error);
      return [];
    }
  }

  function saveHistory() {
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, MAX_HISTORY)));
    } catch (error) {
      console.warn("[step-auto-grader] Не удалось сохранить историю:", error);
    }
  }

  function addHistory(entry) {
    state.history.unshift({
      time: new Date().toISOString(),
      ...entry,
    });
    state.history = state.history.slice(0, MAX_HISTORY);
    saveHistory();
    scheduleUiUpdate();
  }

  function isStopped() {
    return state.stopRequested || Boolean(state.runContext?.controller.signal.aborted);
  }

  const sleep = (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(STOPPED);
        return;
      }

      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        resolve(STOPPED);
      };

      timer = setTimeout(() => {
        cleanup();
        resolve();
      }, Math.max(0, Number(ms) || 0));
      signal?.addEventListener("abort", onAbort, { once: true });
    });

  const waitUntil = async (
    predicate,
    timeout,
    interval = DEFAULT_SETTINGS.pollInterval,
    signal = state.runContext?.controller.signal
  ) => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
      if (isStopped() || signal?.aborted) {
        return STOPPED;
      }

      try {
        const result = predicate();
        if (result) {
          return result;
        }
      } catch (error) {
        // DOM может измениться прямо во время проверки. Это ожидаемо для polling,
        // но остаётся видимым в консоли вместо безмолвного подавления.
        console.debug("[step-auto-grader] DOM polling повторит проверку:", error);
      }

      if (await sleep(interval, signal) === STOPPED) {
        return STOPPED;
      }
    }

    return null;
  };

  const hasGradeButtons = (form) =>
    form.querySelectorAll(SELECTORS.gradeButtons).length > 0;

  const hasSelectedGrade = (form) =>
    Boolean(form.querySelector(`${SELECTORS.gradeButtons}[aria-checked="true"]`));

  const areGradeButtonsEnabled = (form) => {
    const buttons = Array.from(form.querySelectorAll(SELECTORS.gradeButtons));
    return buttons.some(
      (button) => !button.disabled && button.getAttribute("aria-disabled") !== "true"
    );
  };

  const findUnprocessedForm = (ignoredForms = null) => {
    const forms = document.querySelectorAll(SELECTORS.forms);
    for (const form of forms) {
      if (
        form.isConnected &&
        !ignoredForms?.has(form) &&
        hasGradeButtons(form) &&
        !hasSelectedGrade(form)
      ) {
        return form;
      }
    }
    return null;
  };

  const getPendingCount = () => document.querySelectorAll(SELECTORS.forms).length
    ? Array.from(document.querySelectorAll(SELECTORS.forms)).filter(
        (form) => hasGradeButtons(form) && !hasSelectedGrade(form)
      ).length
    : 0;

  const waitFormReady = async (form, settings, signal) => {
    const ready = await waitUntil(
      () =>
        form?.isConnected &&
        hasGradeButtons(form) &&
        areGradeButtonsEnabled(form),
      settings.maxWaitFormReady,
      200,
      signal
    );

    if (ready === STOPPED) {
      return STOPPED;
    }

    if (ready) {
      return true;
    }

    if (!form?.isConnected) {
      console.log("  форма исчезла из DOM, прерываю ожидание");
    } else {
      console.log("  форма так и не разблокировалась (таймаут ожидания ready)");
    }

    return false;
  };

  const waitForNextForm = async (settings, ignoredForms = null, signal) => {
    const form = await waitUntil(
      () => findUnprocessedForm(ignoredForms),
      settings.maxWaitTime,
      settings.nextFormPollInterval,
      signal
    );

    if (form === STOPPED) {
      return STOPPED;
    }

    if (!form) {
      console.log("  таймаут ожидания новой формы");
      return null;
    }

    console.log(`  найдена форма с ${form.querySelectorAll(SELECTORS.gradeButtons).length} кнопками оценок`);
    return form;
  };

  function getAvailableGrades(form) {
    return Array.from(form.querySelectorAll(SELECTORS.gradeButtons))
      .filter(
        (button) => !button.disabled && button.getAttribute("aria-disabled") !== "true"
      )
      .map((button) => button.querySelector(SELECTORS.gradeLabel)?.textContent.trim())
      .map((text) => Number.parseInt(text, 10))
      .filter((grade) => !Number.isNaN(grade));
  }

  function getAvailableGrade(form, settings) {
    const grades = getAvailableGrades(form);
    if (!grades.length) {
      return null;
    }

    const preferred = grades.filter(
      (grade) => grade >= settings.minGrade && grade <= settings.maxGrade
    );
    const pool = preferred.length ? preferred : grades;

    if (settings.strategy === "preferred-low") {
      return Math.min(...pool);
    }
    if (settings.strategy === "preferred-high") {
      return Math.max(...pool);
    }

    return pool[Math.floor(Math.random() * pool.length)];
  }

  const clickGradeButton = (form, grade) => {
    for (const button of form.querySelectorAll(SELECTORS.gradeButtons)) {
      const label = button.querySelector(SELECTORS.gradeLabel);
      if (!label || label.textContent.trim() !== String(grade)) {
        continue;
      }
      if (button.disabled || button.getAttribute("aria-disabled") === "true") {
        console.log(`  кнопка с оценкой ${grade} disabled`);
        return false;
      }
      if (isStopped()) {
        return STOPPED;
      }
      button.click();
      console.log(`  выбрана оценка: ${grade}`);
      return true;
    }

    console.log(`  не найдена кнопка с оценкой ${grade}`);
    return false;
  };

  const findAcceptButton = (form) => {
    for (const button of form.querySelectorAll("button")) {
      if (button.textContent?.trim().includes("Принять")) {
        return button;
      }
    }
    return null;
  };

  const setNativeTextareaValue = (textarea, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    if (descriptor?.set) {
      descriptor.set.call(textarea, value);
      return;
    }
    textarea.value = value;
  };

  const fillAutoComment = (form, settings) => {
    const textarea = form.querySelector(SELECTORS.comment);
    if (!textarea) {
      console.log("  поле комментария не найдено");
      return false;
    }
    if (isStopped()) {
      return STOPPED;
    }

    setNativeTextareaValue(textarea, settings.autoComment);
    for (const eventName of ["input", "change", "blur"]) {
      textarea.dispatchEvent(new Event(eventName, { bubbles: true }));
    }
    console.log(`  добавлен авто-комментарий "${settings.autoComment}"`);
    return true;
  };

  const waitForAcceptButton = (form, settings, signal) =>
    waitUntil(
      () => (form?.isConnected ? findAcceptButton(form) : null),
      settings.maxWaitAccept,
      DEFAULT_SETTINGS.pollInterval,
      signal
    );

  const waitForAcceptEnabled = (form, settings, signal) =>
    waitUntil(() => {
      if (!form?.isConnected) {
        return null;
      }
      const button = findAcceptButton(form);
      return button &&
        !button.disabled &&
        button.getAttribute("aria-disabled") !== "true"
        ? button
        : null;
    }, settings.maxWaitAccept, DEFAULT_SETTINGS.pollInterval, signal);

  const waitSubmitFinished = async (form, formsCountBeforeSubmit, settings, signal) => {
    const result = await waitUntil(() => {
      if (!form.isConnected) {
        return true;
      }
      if (document.querySelectorAll(SELECTORS.forms).length !== formsCountBeforeSubmit) {
        return true;
      }
      const nextForm = findUnprocessedForm();
      return nextForm && nextForm !== form;
    }, settings.maxWaitSubmit, DEFAULT_SETTINGS.pollInterval, signal);
    return result === STOPPED ? STOPPED : Boolean(result);
  };

  const submitForm = async (form, settings, signal) => {
    if (isStopped()) {
      return { ok: false, stopped: true, reason: "stopped_before_submit" };
    }

    let acceptButton = await waitForAcceptButton(form, settings, signal);
    if (acceptButton === STOPPED) {
      return { ok: false, stopped: true, reason: "stopped_waiting_for_accept" };
    }
    if (!acceptButton) {
      console.log('  кнопка "Принять" не найдена');
      return { ok: false, reason: "accept_button_missing" };
    }

    if (acceptButton.disabled || acceptButton.getAttribute("aria-disabled") === "true") {
      console.log(`  "Принять" disabled, пробуем автокомментарий "${settings.autoComment}"`);
      const commentAdded = fillAutoComment(form, settings);
      if (commentAdded === STOPPED) {
        return { ok: false, stopped: true, reason: "stopped_before_comment" };
      }
      if (!commentAdded) {
        return { ok: false, reason: "comment_field_missing" };
      }
      acceptButton = await waitForAcceptEnabled(form, settings, signal);
      if (acceptButton === STOPPED) {
        return { ok: false, stopped: true, reason: "stopped_waiting_for_accept" };
      }
      if (!acceptButton) {
        console.log(`  "Принять" так и не стала активной после "${settings.autoComment}"`);
        return { ok: false, reason: "accept_button_still_disabled" };
      }
    }

    if (isStopped() || !form.isConnected) {
      return { ok: false, stopped: isStopped(), reason: "form_disconnected_before_submit" };
    }

    const formsCountBeforeSubmit = document.querySelectorAll(SELECTORS.forms).length;
    acceptButton.click();
    console.log('  нажата кнопка "Принять"');

    const submitted = await waitSubmitFinished(form, formsCountBeforeSubmit, settings, signal);
    if (submitted === STOPPED) {
      return { ok: false, stopped: true, reason: "stopped_waiting_for_submit" };
    }
    if (!submitted) {
      console.log("  submit не подтвержден за отведённое время");
      return { ok: false, reason: "submit_not_confirmed" };
    }
    return { ok: true };
  };

  function getFormLabel(form, index) {
    return (
      form.getAttribute("data-student") ||
      form.getAttribute("data-student-name") ||
      `форма #${index}`
    ).slice(0, 100);
  }

  const processOneForm = async (form, index, settings, signal) => {
    console.log(`\n--- студент ${index} ---`);
    if (!form?.isConnected) {
      return { ok: false, reason: "form_disconnected" };
    }

    const ready = await waitFormReady(form, settings, signal);
    if (ready === STOPPED) {
      return { ok: false, stopped: true, reason: "stopped_waiting_for_ready" };
    }
    if (!ready) {
      console.log("  форма так и не стала активной, пропуск");
      return { ok: false, reason: "form_not_ready" };
    }
    if (isStopped()) {
      return { ok: false, stopped: true, reason: "stopped_after_ready" };
    }
    if (hasSelectedGrade(form)) {
      console.log("  оценка уже выбрана - пропуск");
      return { ok: true, skipped: true, reason: "grade_already_selected" };
    }

    const grade = getAvailableGrade(form, settings);
    if (grade == null) {
      console.log("  нет доступных оценок в форме");
      return { ok: false, reason: "grade_unavailable" };
    }

    if (settings.dryRun) {
      console.log(`  [dry-run] preview: оценка ${grade}, кнопки не нажимаются`);
      return { ok: true, preview: true, grade };
    }

    const gradeClicked = clickGradeButton(form, grade);
    if (gradeClicked === STOPPED) {
      return { ok: false, stopped: true, reason: "stopped_before_grade" };
    }
    if (!gradeClicked) {
      return { ok: false, reason: "grade_click_failed", grade };
    }

    const submitResult = await submitForm(form, settings, signal);
    if (!submitResult.ok) {
      console.log(`  ошибка: ${submitResult.reason}`);
      return { ...submitResult, grade };
    }
    console.log("  ✓ готов");
    return { ok: true, grade };
  };

  function updateStats(result) {
    state.stats.total += 1;
    if (result.stopped) {
      return;
    }
    if (result.preview) {
      state.stats.previews += 1;
    } else if (result.skipped) {
      state.stats.skipped += 1;
    } else if (result.ok) {
      state.stats.success += 1;
    } else {
      state.stats.failures += 1;
      state.stats.errors[result.reason] = (state.stats.errors[result.reason] || 0) + 1;
    }
    if (result.grade != null) {
      state.stats.gradeCounts[result.grade] = (state.stats.gradeCounts[result.grade] || 0) + 1;
    }
  }

  const snapshotStats = () => ({
    ...state.stats,
    gradeCounts: { ...state.stats.gradeCounts },
    errors: { ...state.stats.errors },
  });

  const runSequentially = async (runContext) => {
    const settings = normalizeSettings(state.settings);
    const previewedForms = new WeakSet();
    state.stats = createStats();
    state.stopRequested = false;
    state.running = true;
    state.status = "running";
    state.runContext = runContext;
    scheduleUiUpdate();
    console.log("старт последовательной обработки...");

    let index = 0;
    let consecutiveFailures = 0;
    try {
      while (!isStopped()) {
        console.log(
          `\nпоиск следующей формы (обработано: ${state.stats.total}, ` +
            `успешно: ${state.stats.success}, ошибок: ${state.stats.failures}, ` +
            `подряд ошибок: ${consecutiveFailures})...`
        );

        const form = settings.dryRun && state.stats.previews > 0
          ? findUnprocessedForm(previewedForms)
          : await waitForNextForm(settings, previewedForms, runContext.controller.signal);
        if (form === STOPPED) {
          state.stats.stopped = true;
          break;
        }
        if (!form) {
          console.log(
            settings.dryRun && state.stats.previews
              ? "\npreview доступных форм завершён - выхожу"
              : "\nнет новой формы - выхожу"
          );
          break;
        }

        index += 1;
        const result = await processOneForm(
          form,
          index,
          settings,
          runContext.controller.signal
        );

        updateStats(result);
        addHistory({
          label: getFormLabel(form, index),
          grade: result.grade ?? null,
          status: result.preview ? "preview" : result.ok ? (result.skipped ? "skipped" : "success") : result.stopped ? "stopped" : "error",
          reason: result.reason || null,
        });
        if (result.preview) {
          previewedForms.add(form);
        }
        scheduleUiUpdate();

        if (result.stopped || isStopped()) {
          state.stats.stopped = true;
          break;
        }
        if (result.ok) {
          consecutiveFailures = 0;
        } else {
          consecutiveFailures += 1;
          if (consecutiveFailures >= settings.maxFailures) {
            console.log(`\nслишком много подряд неудач (${consecutiveFailures}), останавливаюсь`);
            break;
          }
        }
      }

      if (isStopped()) {
        state.stats.stopped = true;
      }
    } finally {
      if (isStopped()) {
        state.stats.stopped = true;
      }
      const completedStats = snapshotStats();
      state.running = false;
      state.status = "idle";
      state.runContext = null;
      state.stopRequested = false;
      scheduleUiUpdate();
      const summary = {
        ...completedStats,
        ok: !completedStats.stopped,
        stopped: completedStats.stopped,
      };
      console.log("\n=== обработка завершена ===");
      console.log(`успешно обработано студентов: ${summary.success}`);
      console.log(`preview: ${summary.previews}`);
      console.log(`пропущено: ${summary.skipped}`);
      console.log(`ошибок: ${summary.failures}`);
      if (Object.keys(summary.errors).length) {
        console.log("\nошибки по типам:");
        console.table(summary.errors);
      }
      return summary;
    }
  };

  const processAllSequentially = () => {
    if (state.running) {
      console.log("[step-auto-grader] Запуск уже выполняется — второй запуск не создан.");
      return state.runPromise;
    }
    const runContext = {
      id: Symbol("run"),
      controller: new AbortController(),
    };
    state.runPromise = runSequentially(runContext);
    return state.runPromise;
  };

  const stopAllFormsSequentially = () => {
    if (!state.running) {
      console.log("[step-auto-grader] Последовательный запуск не выполняется.");
      return { ok: false, stopped: false, reason: "not_running" };
    }
    if (state.status === "stopping") {
      return { ok: true, stopped: true, reason: "already_stopping" };
    }
    state.stopRequested = true;
    state.status = "stopping";
    state.runContext?.controller.abort();
    scheduleUiUpdate();
    console.log("[step-auto-grader] Запрошена остановка; текущий шаг будет завершён безопасно.");
    return { ok: true, stopped: true, reason: "stop_requested" };
  };

  function svgIcon(name) {
    const paths = {
      play: '<path d="m7 4 13 8-13 8V4Z"/>',
      stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
      gear: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1-1.5 2.6-.2-.1a2 2 0 0 0-2 .1l-.2.1a2 2 0 0 0-1 1.7v.2h-3v-.2a2 2 0 0 0-1-1.7l-.2-.1a2 2 0 0 0-2-.1l-.2.1-1.5-2.6.1-.1a2 2 0 0 0 .8-1.8v-.3a2 2 0 0 0-.8-1.8l-.1-.1 1.5-2.6.2.1a2 2 0 0 0 2-.1l.2-.1a2 2 0 0 0 1-1.7V6h3v.2a2 2 0 0 0 1 1.7l.2.1a2 2 0 0 0 2 .1l.2-.1 1.5 2.6-.1.1a2 2 0 0 0-.8 1.8v.3a2 2 0 0 0 .8 1.8Z"/>',
      chart: '<path d="M5 19V5m0 14h14"/><path d="m8 15 3-4 3 2 4-6"/>',
      history: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M12 8v4l2.5 1.5"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.gear}</svg>`;
  }

  function createPanel() {
    if (state.panel) {
      return state.panel;
    }
    const host = document.createElement("div");
    host.id = "step-auto-grader-panel";
    host.style.cssText = "all:initial;z-index:2147483647;position:fixed;inset:auto 16px 16px auto;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .panel { width: min(380px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto;
          color: #111; background: #fff; border: 1px solid #111; border-radius: 12px;
          box-shadow: 6px 6px 0 #111; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
        .header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px 10px; border-bottom:1px solid #111; }
        h1 { margin:0; font: italic 700 15px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:-.04em; }
        .subtle, .history time { color:#666; font-size:11px; }
        .body { padding: 12px 16px 16px; }
        .controls { display:flex; gap:8px; margin-bottom:12px; }
        button, input, select, textarea { color:#111; background:#fff; border:1px solid #111; border-radius:6px; font:inherit; }
        button { cursor:pointer; padding:8px 10px; display:inline-flex; align-items:center; justify-content:center; gap:6px; }
        button:hover:not(:disabled) { background:#111; color:#fff; }
        button:disabled { opacity:.38; cursor:not-allowed; }
        button svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
        .primary { flex:1; background:#111; color:#fff; }
        .primary:hover:not(:disabled) { background:#444; }
        .fields { display:grid; grid-template-columns:1fr 1fr; gap:9px; }
        label { display:flex; flex-direction:column; gap:4px; font-size:11px; }
        label.full { grid-column:1/-1; }
        input, select { min-height:31px; padding:5px 7px; }
        .check { flex-direction:row; align-items:center; justify-content:flex-start; padding-top:17px; }
        .check input { min-height:auto; accent-color:#111; }
        .section { margin-top:15px; padding-top:11px; border-top:1px solid #ddd; }
        .section-title { display:flex; align-items:center; gap:6px; margin-bottom:8px; font-weight:700; }
        .section-title svg { width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
        .status { padding:8px 10px; background:#f4f4f4; border-left:3px solid #111; font-style:italic; }
        .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; text-align:center; }
        .stat { border:1px solid #ddd; padding:6px 3px; border-radius:5px; }
        .stat b { display:block; font-size:16px; }
        .stat span { color:#666; font-size:10px; }
        .history { display:grid; gap:5px; }
        .history-row { display:flex; justify-content:space-between; gap:8px; padding:5px 0; border-bottom:1px dotted #bbb; }
        .history-row .label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block; }
        .tag { white-space:nowrap; font-size:10px; }
        @media (max-width:480px) { .panel { width:calc(100vw - 20px); } .header,.body { padding-left:11px; padding-right:11px; } }
      </style>
      <section class="panel" aria-label="Step auto grader">
        <header class="header"><h1>step / auto grader</h1><span class="subtle" data-version>v2</span></header>
        <div class="body">
          <div class="controls">
            <button type="button" class="primary" data-start aria-label="Запустить обработку">${svgIcon("play")}<span>Запустить</span></button>
            <button type="button" data-stop aria-label="Остановить обработку">${svgIcon("stop")}<span>Стоп</span></button>
          </div>
          <div class="status" data-status aria-live="polite" aria-atomic="true">Готов к запуску</div>
          <div class="section">
            <div class="section-title">${svgIcon("gear")} настройки</div>
            <div class="fields">
              <label>min grade<input type="number" min="0" max="100" data-setting="minGrade"></label>
              <label>max grade<input type="number" min="0" max="100" data-setting="maxGrade"></label>
              <label class="full">комментарий<textarea rows="2" data-setting="autoComment"></textarea></label>
              <label>max failures<input type="number" min="1" max="100" data-setting="maxFailures"></label>
              <label>стратегия<select data-setting="strategy">
                <option value="random">random</option><option value="preferred-low">preferred-low</option><option value="preferred-high">preferred-high</option>
              </select></label>
              <label class="check full"><input type="checkbox" data-setting="dryRun"> dry-run (только preview)</label>
            </div>
          </div>
          <div class="section">
            <div class="section-title">${svgIcon("chart")} статистика</div>
            <div class="stats">
              <div class="stat"><b data-stat="success">0</b><span>готово</span></div>
              <div class="stat"><b data-stat="previews">0</b><span>preview</span></div>
              <div class="stat"><b data-stat="skipped">0</b><span>пропуск</span></div>
              <div class="stat"><b data-stat="failures">0</b><span>ошибки</span></div>
            </div>
            <div class="subtle" data-pending style="margin-top:7px"></div>
            <div class="subtle" data-grades style="margin-top:4px"></div>
          </div>
          <div class="section">
            <div class="section-title">${svgIcon("history")} последние формы</div>
            <div class="history" data-history></div>
          </div>
        </div>
      </section>`;

    (document.body || document.documentElement).appendChild(host);
    const elements = {
      host,
      shadow,
      start: shadow.querySelector("[data-start]"),
      stop: shadow.querySelector("[data-stop]"),
      status: shadow.querySelector("[data-status]"),
      pending: shadow.querySelector("[data-pending]"),
      grades: shadow.querySelector("[data-grades]"),
      settings: Object.fromEntries(
        Array.from(shadow.querySelectorAll("[data-setting]")).map((element) => [
          element.dataset.setting,
          element,
        ])
      ),
      stats: Object.fromEntries(
        Array.from(shadow.querySelectorAll("[data-stat]")).map((element) => [
          element.dataset.stat,
          element,
        ])
      ),
      history: shadow.querySelector("[data-history]"),
    };

    for (const [key, input] of Object.entries(elements.settings)) {
      const eventName = input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input";
      input.addEventListener(eventName, () => {
        state.settings = normalizeSettings({
          ...state.settings,
          [key]: input.type === "checkbox" ? input.checked : input.value,
        });
        saveSettings();
        syncPanel();
      });
    }
    elements.start.addEventListener("click", () => {
      void processAllSequentially();
    });
    elements.stop.addEventListener("click", () => {
      stopAllFormsSequentially();
    });
    state.panel = elements;
    syncPanel();
    return elements;
  }

  function formatHistoryTime(value) {
    try {
      return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "--:--";
    }
  }

  function syncPanel() {
    if (!state.panel) {
      return;
    }
    const panel = state.panel;
    for (const [key, input] of Object.entries(panel.settings)) {
      input[input.type === "checkbox" ? "checked" : "value"] = state.settings[key];
    }
    panel.start.disabled = state.running;
    panel.stop.disabled = !state.running;
    panel.start.setAttribute("aria-disabled", String(state.running));
    panel.stop.setAttribute("aria-disabled", String(!state.running));
    panel.status.textContent = state.status === "running"
      ? `${state.settings.dryRun ? "dry-run · " : ""}обработка… форма ${state.stats.total + 1}`
      : state.status === "stopping"
        ? "Остановка…"
        : state.stats.stopped
          ? "Остановлено пользователем"
          : "Готов к запуску";
    panel.pending.textContent = `в DOM доступно форм: ${getPendingCount()}`;
    const gradeSummary = Object.entries(state.stats.gradeCounts)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([grade, count]) => `${grade}: ${count}`)
      .join(" · ");
    panel.grades.textContent = gradeSummary ? `оценки: ${gradeSummary}` : "оценки: —";
    for (const [key, element] of Object.entries(panel.stats)) {
      element.textContent = state.stats[key] ?? 0;
    }
    panel.history.innerHTML = state.history.length
      ? state.history.slice(0, 8).map((entry) => `
        <div class="history-row">
          <span class="label">${escapeHtml(entry.label || "форма")}</span>
          <span class="tag">${escapeHtml(entry.status)} · ${formatHistoryTime(entry.time)}</span>
        </div>`).join("")
      : '<span class="subtle">История пока пуста</span>';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    }[character]));
  }

  function scheduleUiUpdate() {
    if (state.updateScheduled) {
      return;
    }
    state.updateScheduled = true;
    queueMicrotask(() => {
      state.updateScheduled = false;
      syncPanel();
    });
  }

  function observeDom() {
    if (!document.body || state.observer) {
      return;
    }
    state.observer = new MutationObserver(() => scheduleUiUpdate());
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  window.processAllFormsSequentially = processAllSequentially;
  window.stopAllFormsSequentially = stopAllFormsSequentially;
  createPanel();
  observeDom();

  console.log("скрипт загружен. UI готов, запускаю processAllFormsSequentially()");
  void processAllSequentially();
})();
