# step-auto-grader

Самодостаточный browser automation script для последовательной обработки домашних
работ в IT Step Academy. Скрипт работает прямо в Console на странице проверки:
он сохраняет текущие Angular-селекторы и native setter, но добавляет
монохромную панель управления, настройки, статистику и безопасный режим
предпросмотра.

> Скрипт не использует внешний API или внешние ресурсы. Он выставляет оценки и
> подтверждает работы, поэтому запускайте его только в соответствии с вашим
> workflow и сначала проверяйте изменения на небольшом количестве форм.

## Возможности

- строгая последовательная обработка: следующая форма начинается только после
  подтверждения submit предыдущей;
- встроенная адаптивная Shadow DOM-панель с inline SVG-иконками, обычной и
  наклонной моноширинной типографикой;
- start/stop controls и защита от параллельных запусков;
- min/max grade, авто-комментарий, лимит последовательных ошибок;
- стратегии выбора оценки: `random`, `preferred-low`, `preferred-high`;
- `dry-run`: выбирает и логирует preview, но **не нажимает** оценку и
  `Принять`, не меняет комментарий;
- live counters: успешные формы, preview, пропуски и ошибки;
- summary по текущему запуску и распределение выбранных оценок;
- последние обработанные формы и выбранные оценки в localStorage;
- MutationObserver для обновления счётчиков при появлении новых форм;
- понятный лог в DevTools Console и остановка между шагами и ожиданиями.

## Запуск

1. Откройте страницу проверки домашних заданий IT Step Academy.
2. Откройте DevTools (`F12` или `Cmd + Option + I` на macOS).
3. Перейдите в `Console` и вставьте содержимое `index.js`.
4. Нажмите Enter.

Панель появится справа снизу, а для сохранения прежнего поведения скрипт сразу
запустит обработку. Перед реальной обработкой можно включить `dry-run`.

## Панель и настройки

Настройки сохраняются при изменении. Безопасные значения по умолчанию:

| Настройка | По умолчанию | Назначение |
| --- | ---: | --- |
| `min grade` | `9` | Нижняя граница предпочитаемого диапазона |
| `max grade` | `12` | Верхняя граница предпочитаемого диапазона |
| `комментарий` | `good` | Заполняется только если `Принять` disabled |
| `max failures` | `5` | Остановка после подряд идущих ошибок |
| `стратегия` | `random` | Алгоритм выбора доступной оценки |
| `dry-run` | выключен | Только preview, без действий изменения страницы |

Если в заданном диапазоне нет доступных оценок, используется весь доступный
список. `preferred-low` и `preferred-high` выбирают соответственно минимальную
или максимальную оценку из этого пула; `random` выбирает случайную.

### Управление остановкой

Кнопка **Стоп** устанавливает флаг остановки. Текущий DOM-polling или ожидание
завершается на ближайшей проверке, после чего новая форма не берётся. Grade и
`Принять` не нажимаются после запроса остановки. Повторный клик запуска не
создаёт второй параллельный цикл.

## Hotkeys и API

Горячих клавиш по умолчанию нет: управление выполняется кнопками панели.
Глобальные функции доступны из Console:

```js
window.processAllFormsSequentially(); // запустить или вернуть текущий Promise
window.stopAllFormsSequentially();    // запросить остановку
```

`processAllFormsSequentially()` возвращает Promise с итогом:

```js
{
  ok: true,
  stopped: false,
  total: 10,
  success: 9,
  previews: 0,
  skipped: 0,
  failures: 1,
  gradeCounts: { 9: 2, 11: 7 },
  errors: {}
}
```

`stopAllFormsSequentially()` синхронно возвращает `{ ok: true, stopped: true }`
при активной обработке или `{ ok: false, reason: "not_running" }`, если
останавливать нечего.

## localStorage

Скрипт сохраняет только настройки и локальную историю в текущем origin:

- `step-auto-grader:settings` — настройки панели;
- `step-auto-grader:history` — последние 20 результатов (время, форма,
  статус, оценка и причина).

Историю можно очистить вручную из Console:

```js
localStorage.removeItem("step-auto-grader:history");
```

Некорректные или недоступные значения localStorage не останавливают скрипт:
используются fallback-настройки, а проблема явно логируется.

## Как работает обработка

```text
find form
  ↓
wait until ready
  ↓
get available grades
  ↓
select using configured strategy
  ↓
dry-run? ─ yes → log preview, no click
  ↓ no
click grade
  ↓
find "Принять"; if disabled → native-set comment → wait enabled
  ↓
click "Принять"
  ↓
wait for Angular DOM update
  ↓
next form
```

Остановка проверяется перед новым шагом, перед кликом оценки, перед
комментарием, перед submit и внутри ожиданий. DOM polling допускает ожидаемое
изменение Angular DOM, но диагностирует такие проверки через `console.debug`;
неожиданные ошибки формы логируются через `console.error` и считаются ошибкой,
а не молча подавляются.

## Angular Forms и селекторы

Сохраняются текущие селекторы:

```css
app-homework-review form[novalidate]
mat-button-toggle button
.mat-button-toggle-label-content
textarea[formcontrolname="coment"]
```

Для комментария используется setter `HTMLTextAreaElement.prototype.value`,
после чего отправляются `input`, `change` и `blur`, чтобы Angular Reactive Forms
увидел изменение. Успешный submit определяется по удалению исходной формы,
изменению количества форм или появлению другой необработанной формы.

## Ограничения и безопасность

Скрипт зависит от HTML-структуры и Angular-компонентов текущей платформы.
Изменение селекторов или текста `Принять` потребует обновления `index.js`.
Вкладка должна оставаться открытой во время обработки.

Не вставляйте скрипт на сторонние страницы и не включайте автоматический режим,
если не проверили диапазон оценок и комментарий. Встроенная панель не загружает
шрифты, иконки, JavaScript или данные с внешних доменов; localStorage доступен
всему JavaScript текущего origin.

## Структура

```text
step-auto-grader/
├── index.js   # automation flow, UI, state и localStorage
└── README.md  # инструкция, API и ограничения
```

## Проверка

Синтаксис можно проверить без браузера:

```bash
node --check index.js
```

Чистые helpers стратегий и счётчиков покрыты отдельными тестами:

```bash
node --test index.test.js
```

## Disclaimer

Проект является вспомогательным инструментом browser automation. Он не является
официальным продуктом IT Step Academy и не связан с разработчиками платформы.
## CI/CD and publication channels

Every workflow runs the Node test suite, the isolated Vitest suite, and the
extension build before publishing. Pushes to non-`main`/non-`dev` branches are
published as prereleases with an `alpha` tag and archive suffix. Pushes to
`dev` are published as `beta` prereleases. Production releases are published
only from `vMAJOR.MINOR.PATCH` tags that point to a commit contained in `main`;
their archives have no alpha/beta suffix.
