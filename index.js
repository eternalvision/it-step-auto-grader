(() => {
  "use strict";

  const MIN_GRADE = 9;
  const MAX_GRADE = 12;

  const AUTO_COMMENT = "good";

  const MAX_WAIT_TIME = 20_000;
  const MAX_WAIT_FORM_READY = 15_000;
  const MAX_WAIT_ACCEPT = 5_000;
  const MAX_WAIT_SUBMIT = 10_000;

  const POLL_INTERVAL = 100;
  const NEXT_FORM_POLL_INTERVAL = 300;

  const MAX_CONSECUTIVE_FAILURES = 5;

  const sleep = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const waitUntil = async (predicate, timeout, interval = POLL_INTERVAL) => {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        const result = predicate();

        if (result) {
          return result;
        }
      } catch {
        // dom мог измениться прямо во время проверки
      }

      await sleep(interval);
    }

    return null;
  };

  // есть ли в форме кнопки с оценками
  const hasGradeButtons = (form) => form.querySelectorAll("mat-button-toggle button").length > 0;

  // есть ли уже выбранная оценка
  const hasSelectedGrade = (form) =>
    Boolean(form.querySelector('mat-button-toggle button[aria-checked="true"]'));

  // есть ли хотя бы одна активная кнопка оценки
  const areGradeButtonsEnabled = (form) => {
    const buttons = Array.from(form.querySelectorAll("mat-button-toggle button"));

    if (!buttons.length) {
      return false;
    }

    return buttons.some(
      (button) => !button.disabled && button.getAttribute("aria-disabled") !== "true"
    );
  };

  // ждём, пока форма выйдет из loading-состояния
  const waitFormReady = async (form) => {
    const ready = await waitUntil(
      () => {
        if (!form?.isConnected) {
          return false;
        }

        return hasGradeButtons(form) && areGradeButtonsEnabled(form);
      },
      MAX_WAIT_FORM_READY,
      200
    );

    if (ready) {
      return true;
    }

    if (!form?.isConnected) {
      console.log("  форма исчезла из dom, прерываю ожидание");
    } else {
      console.log("  форма так и не разблокировалась " + "(таймаут ожидания ready)");
    }

    return false;
  };

  // ищем необработанную форму с кнопками оценок
  const findUnprocessedForm = () => {
    const forms = document.querySelectorAll("app-homework-review form[novalidate]");

    for (const form of forms) {
      if (!form.isConnected) {
        continue;
      }

      if (!hasGradeButtons(form)) {
        continue;
      }

      if (hasSelectedGrade(form)) {
        continue;
      }

      return form;
    }

    return null;
  };

  // ждём появления следующей подходящей формы
  const waitForNextForm = async () => {
    const form = await waitUntil(
      () => findUnprocessedForm(),
      MAX_WAIT_TIME,
      NEXT_FORM_POLL_INTERVAL
    );

    if (!form) {
      console.log("  таймаут ожидания новой формы");
      return null;
    }

    const buttons = form.querySelectorAll("mat-button-toggle button");

    console.log(`  найдена форма с ${buttons.length} кнопками оценок`);

    return form;
  };

  // собираем список доступных оценок
  const getAvailableGrade = (form) => {
    const buttons = Array.from(form.querySelectorAll("mat-button-toggle button"));

    const grades = buttons
      .map((button) => button.querySelector(".mat-button-toggle-label-content")?.textContent.trim())
      .map((text) => parseInt(text, 10))
      .filter((grade) => !Number.isNaN(grade));

    if (!grades.length) {
      return null;
    }

    const preferred = grades.filter((grade) => grade >= MIN_GRADE && grade <= MAX_GRADE);

    const pool = preferred.length ? preferred : grades;

    const randomIndex = Math.floor(Math.random() * pool.length);

    return pool[randomIndex];
  };

  const clickGradeButton = (form, grade) => {
    const buttons = form.querySelectorAll("mat-button-toggle button");

    for (const button of buttons) {
      const label = button.querySelector(".mat-button-toggle-label-content");

      if (!label) {
        continue;
      }

      if (label.textContent.trim() !== String(grade)) {
        continue;
      }

      if (button.disabled || button.getAttribute("aria-disabled") === "true") {
        console.log(`  кнопка с оценкой ${grade} disabled`);

        return false;
      }

      button.click();

      console.log(`  выбрана оценка: ${grade}`);

      return true;
    }

    console.log(`  не найдена кнопка с оценкой ${grade}`);

    return false;
  };

  const findAcceptButton = (form) => {
    const buttons = form.querySelectorAll("button");

    for (const button of buttons) {
      const text = button.textContent?.trim();

      if (text?.includes("Принять")) {
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

  // минимальный комментарий "good"
  const fillAutoComment = (form) => {
    const textarea = form.querySelector('textarea[formcontrolname="coment"]');

    if (!textarea) {
      console.log("  поле комментария не найдено");

      return false;
    }

    setNativeTextareaValue(textarea, AUTO_COMMENT);

    textarea.dispatchEvent(
      new Event("input", {
        bubbles: true,
      })
    );

    textarea.dispatchEvent(
      new Event("change", {
        bubbles: true,
      })
    );

    textarea.dispatchEvent(
      new Event("blur", {
        bubbles: true,
      })
    );

    console.log(`  добавлен авто-комментарий "${AUTO_COMMENT}"`);

    return true;
  };

  // ждём появления кнопки "Принять"
  const waitForAcceptButton = async (form) =>
    waitUntil(() => {
      if (!form?.isConnected) {
        return null;
      }

      return findAcceptButton(form);
    }, MAX_WAIT_ACCEPT);

  // ждём, пока "Принять" станет активной
  const waitForAcceptEnabled = async (form) =>
    waitUntil(() => {
      if (!form?.isConnected) {
        return null;
      }

      const button = findAcceptButton(form);

      if (!button) {
        return null;
      }

      if (button.disabled || button.getAttribute("aria-disabled") === "true") {
        return null;
      }

      return button;
    }, MAX_WAIT_ACCEPT);

  /*
   * ждём подтверждения submit.
   *
   * основной сигнал:
   * Angular удалил старую форму из DOM после
   * успешной обработки.
   *
   * дополнительно проверяем, что количество
   * app-homework-review изменилось или появилась
   * другая необработанная форма.
   */
  const waitSubmitFinished = async (form, formsCountBeforeSubmit) => {
    const result = await waitUntil(() => {
      if (!form.isConnected) {
        return true;
      }

      const currentForms = document.querySelectorAll("app-homework-review form[novalidate]");

      if (currentForms.length !== formsCountBeforeSubmit) {
        return true;
      }

      const nextForm = findUnprocessedForm();

      if (nextForm && nextForm !== form) {
        return true;
      }

      return false;
    }, MAX_WAIT_SUBMIT);

    return Boolean(result);
  };

  const submitForm = async (form) => {
    let acceptButton = await waitForAcceptButton(form);

    if (!acceptButton) {
      console.log('  кнопка "Принять" не найдена');

      return {
        ok: false,
        reason: "accept_button_missing",
      };
    }

    if (acceptButton.disabled || acceptButton.getAttribute("aria-disabled") === "true") {
      console.log(`  "Принять" disabled, ` + `пробуем автокомментарий "${AUTO_COMMENT}"`);

      const commentAdded = fillAutoComment(form);

      if (!commentAdded) {
        return {
          ok: false,
          reason: "comment_field_missing",
        };
      }

      acceptButton = await waitForAcceptEnabled(form);

      if (!acceptButton) {
        console.log(`  "Принять" так и не стала активной ` + `после "${AUTO_COMMENT}"`);

        return {
          ok: false,
          reason: "accept_button_still_disabled",
        };
      }
    }

    if (!form.isConnected) {
      return {
        ok: false,
        reason: "form_disconnected_before_submit",
      };
    }

    const formsCountBeforeSubmit = document.querySelectorAll(
      "app-homework-review form[novalidate]"
    ).length;

    acceptButton.click();

    console.log('  нажата кнопка "Принять"');

    const submitted = await waitSubmitFinished(form, formsCountBeforeSubmit);

    if (!submitted) {
      console.log("  submit не подтвержден за отведённое время");

      return {
        ok: false,
        reason: "submit_not_confirmed",
      };
    }

    return {
      ok: true,
    };
  };

  const processOneForm = async (form, index) => {
    console.log(`\n--- студент ${index} ---`);

    if (!form?.isConnected) {
      console.log("  форма потеряна из dom, пропуск");

      return {
        ok: false,
        reason: "form_disconnected",
      };
    }

    // ждём, пока форма станет активной
    const ready = await waitFormReady(form);

    if (!ready) {
      console.log("  форма так и не стала активной, пропуск");

      return {
        ok: false,
        reason: "form_not_ready",
      };
    }

    if (!form.isConnected) {
      return {
        ok: false,
        reason: "form_disconnected_after_ready",
      };
    }

    if (hasSelectedGrade(form)) {
      console.log("  оценка уже выбрана - пропуск");

      return {
        ok: true,
        skipped: true,
        reason: "grade_already_selected",
      };
    }

    const grade = getAvailableGrade(form);

    if (grade == null) {
      console.log("  нет доступных оценок в форме");

      return {
        ok: false,
        reason: "grade_unavailable",
      };
    }

    const gradeClicked = clickGradeButton(form, grade);

    if (!gradeClicked) {
      return {
        ok: false,
        reason: "grade_click_failed",
        grade,
      };
    }

    /*
     * здесь больше нет sleep(200).
     *
     * Angular сам обновит form state,
     * а submitForm дождётся появления/
     * активации кнопки.
     */
    const submitResult = await submitForm(form);

    if (!submitResult.ok) {
      console.log(`  ошибка: ${submitResult.reason}`);

      return {
        ...submitResult,
        grade,
      };
    }

    console.log("  ✓ готов");

    return {
      ok: true,
      grade,
    };
  };

  const processAllSequentially = async () => {
    console.log("старт последовательной обработки...");

    let index = 0;

    let successCount = 0;
    let skippedCount = 0;
    let failureCount = 0;

    let consecutiveFailures = 0;

    const errors = {};

    while (true) {
      console.log(
        `\nпоиск следующей формы ` +
          `(успешно: ${successCount}, ` +
          `ошибок: ${failureCount}, ` +
          `подряд ошибок: ${consecutiveFailures})...`
      );

      const form = await waitForNextForm();

      if (!form) {
        console.log("\nнет новой формы - выхожу");

        break;
      }

      index++;

      const result = await processOneForm(form, index);

      if (result.ok) {
        consecutiveFailures = 0;

        if (result.skipped) {
          skippedCount++;
        } else {
          successCount++;
        }

        continue;
      }

      failureCount++;
      consecutiveFailures++;

      errors[result.reason] = (errors[result.reason] ?? 0) + 1;

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.log(
          `\nслишком много подряд неудач ` + `(${consecutiveFailures}), ` + "останавливаюсь"
        );

        break;
      }
    }

    console.log("\n=== обработка завершена ===");

    console.log(`успешно обработано студентов: ${successCount}`);

    console.log(`пропущено: ${skippedCount}`);

    console.log(`ошибок: ${failureCount}`);

    if (Object.keys(errors).length) {
      console.log("\nошибки по типам:");

      console.table(errors);
    }
  };

  window.processAllFormsSequentially = processAllSequentially;

  console.log("скрипт загружен. " + "запускаю processAllFormsSequentially()");

  processAllSequentially();
})();
