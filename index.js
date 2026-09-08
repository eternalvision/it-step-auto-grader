(function () {
  'use strict';

  const MIN_GRADE = 9;
  const MAX_GRADE = 12;
  const DELAY_AFTER_SUBMIT = 800;      // пауза после "принять"
  const MAX_WAIT_TIME = 20000;         // максимум ожидания новой формы (мс)
  const MAX_WAIT_FORM_READY = 15000;   // максимум ожидания, пока кнопки разблокируются
  const MAX_CONSECUTIVE_FAILURES = 10; // защита от вечного цикла

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // есть ли в форме mat-тогглы с оценками
  function hasGradeButtons(form) {
    return form.querySelectorAll('mat-button-toggle button').length > 0;
  }

  // есть ли уже выбранная оценка
  function isFormProcessed(form) {
    return !!form.querySelector(
      'mat-button-toggle button[aria-checked="true"]'
    );
  }

  // кнопки оценок включены (есть хотя бы одна не disabled)?
  function areGradeButtonsEnabled(form) {
    const buttons = Array.from(
      form.querySelectorAll('mat-button-toggle button')
    );
    if (!buttons.length) return false;
    return buttons.some(
      (btn) =>
        !btn.disabled &&
        btn.getAttribute('aria-disabled') !== 'true'
    );
  }

  // ждём, пока форма "оживёт" после глобальной перезагрузки
  async function waitFormReady(form) {
    const start = Date.now();

    while (Date.now() - start < MAX_WAIT_FORM_READY) {
      if (!form.isConnected) {
        console.log('  форма исчезла из dom, прерываю ожидание');
        return false;
      }

      if (hasGradeButtons(form) && areGradeButtonsEnabled(form)) {
        return true;
      }

      await sleep(200);
    }

    console.log('  форма так и не разблокировалась (таймаут ожидания ready)');
    return false;
  }

  // ищем необработанную форму с кнопками оценок
  function findUnprocessedForm() {
    const forms = document.querySelectorAll(
      'app-homework-review form[novalidate]'
    );

    for (let form of forms) {
      if (!form.isConnected) continue;
      if (!hasGradeButtons(form)) continue;
      if (isFormProcessed(form)) continue;
      return form;
    }

    return null;
  }

  // ждём появления подходящей формы
  async function waitForNextForm() {
    const start = Date.now();

    while (Date.now() - start < MAX_WAIT_TIME) {
      const form = findUnprocessedForm();
      if (form) {
        const buttons = form.querySelectorAll('mat-button-toggle button');
        console.log(
            найдена форма с ${buttons.length} кнопками оценок
        );
        return form;
      }

      await sleep(300);
    }

    console.log('  таймаут ожидания новой формы');
    return null;
  }

  // собираем список оценок из кнопок
  function getAvailableGrade(form) {
    const buttons = Array.from(
      form.querySelectorAll('mat-button-toggle button')
    );

    const grades = buttons
      .map((btn) =>
        btn
          .querySelector('.mat-button-toggle-label-content')
          ?.textContent.trim()
      )
      .map((t) => parseInt(t, 10))
      .filter((n) => !Number.isNaN(n));

    if (!grades.length) return null;

    const preferred = grades.filter(
      (g) => g >= MIN_GRADE && g <= MAX_GRADE
    );

    const pool = preferred.length ? preferred : grades;
    const randomIndex = Math.floor(Math.random() * pool.length);
    return pool[randomIndex];
  }

  function clickGradeButton(form, grade) {
    const buttons = form.querySelectorAll('mat-button-toggle button');
    for (let button of buttons) {
      const label = button.querySelector('.mat-button-toggle-label-content');
      if (!label) continue;
      if (label.textContent.trim() === String(grade)) {
        button.click();
        console.log(`  выбрана оценка: ${grade}`);
        return true;
      }
    }
    console.log(`  не найдена кнопка с оценкой ${grade}`);
    return false;
  }

  function findAcceptButton(form) {
    const buttons = form.querySelectorAll('button');
    for (let btn of buttons) {
      const text = btn.textContent?.trim();
      if (text && text.includes('Принять')) {
        return btn;
      }
    }
    return null;
  }
  // минимальный комментарий "good"
    function fillAutoComment(form) {
      const textarea = form.querySelector('textarea[formcontrolname="coment"]');
      if (!textarea) {
        console.log('  поле комментария не найдено');
        return false;
      }

      textarea.value = 'good';

      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.dispatchEvent(new Event('blur', { bubbles: true }));

      console.log('  добавлен авто-комментарий "good"');
      return true;
    }

    async function processOneForm(form, index) {
      if (!form || !form.isConnected) {
        console.log(`\n--- студент ${index} ---`);
        console.log('  форма потеряна из dom, пропуск');
        return false;
      }

      console.log(`\n--- студент ${index} ---`);

      // ждём, пока форма выйдет из "режима загрузки" и кнопки станут активными
      const ready = await waitFormReady(form);
      if (!ready) {
        console.log('  форма так и не стала активной, пропуск');
        return false;
      }

      if (isFormProcessed(form)) {
        console.log('  уже обработан — пропуск');
        return true;
      }

      const grade = getAvailableGrade(form);
      if (grade == null) {
        console.log('  нет доступных оценок в форме');
        return false;
      }

      if (!clickGradeButton(form, grade)) {
        return false;
      }

      await sleep(200);

      let acceptBtn = findAcceptButton(form);
      if (!acceptBtn) {
        console.log('  кнопка "Принять" не найдена');
        return false;
      }

      // первая попытка — без комментария
      if (!acceptBtn.disabled) {
        acceptBtn.click();
        console.log('  нажата кнопка "Принять" без комментария');
        await sleep(DELAY_AFTER_SUBMIT);
        console.log('  ✓ готов');
        return true;
      }

      console.log('  "Принять" disabled, пробуем автокомментарий "good"');

      if (!fillAutoComment(form)) {
        return false;
      }

      await sleep(200);

      acceptBtn = findAcceptButton(form);
      if (!acceptBtn) {
        console.log('  кнопка "Принять" пропала после комментария');
        return false;
      }

      if (acceptBtn.disabled) {
        console.log(
          '  "Принять" всё ещё disabled даже после "good" — форма не уйдёт'
        );
        return false;
      }

      acceptBtn.click();
      console.log('  нажата кнопка "Принять" с автокомментарием "good"');
      await sleep(DELAY_AFTER_SUBMIT);
      console.log('  ✓ готов');
      return true;
    }

    async function processAllSequentially() {
      console.log('старт последовательной обработки...');

      let index = 0;
      let successCount = 0;
      let consecutiveFailures = 0;

      while (true) {
        console.log(
          \nпоиск следующей формы (успешно: ${successCount}, подряд ошибок: ${consecutiveFailures})...
        );

        const form = await waitForNextForm();
        if (!form) {
          console.log('\nнет новой формы — выхожу');
          break;
        }

        index++;
        const ok = await processOneForm(form, index);

        if (ok) {
          successCount++;
          consecutiveFailures = 0;
        } else {
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.log(
              \nслишком много подряд неудач (${consecutiveFailures}), останавливаюсь
            );
            break;
          }
        }
      }

      console.log('\n=== обработка завершена ===');
      console.log(`успешно обработано студентов: ${successCount}`);
    }

    window.processAllFormsSequentially = processAllSequentially;

    console.log('скрипт загружен. запускаю processAllFormsSequentially()');
    processAllSequentially();
  })();
