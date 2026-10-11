# Шортс «AI может завершить чат при оскорблениях»

Вертикальный ролик 1080×1920, 30 fps, 47,5 с. Плоская 2D-графика, палитра и шрифт по ТЗ
(Inter Display Black / ExtraBold), субтитры по 2–4 слова с жёлтой подсветкой текущего слова.

## Что лежит в папке

| Файл | Что это |
|---|---|
| `out/ai-ends-chat.mp4` | готовое видео: графика, субтитры, звуковые эффекты (без голоса и музыки) |
| `out/sfx.wav` | отдельная дорожка эффектов (поп, вуш, дзинь, удар, глитч) |
| `out/subtitles.srt` | субтитры с таймкодами (на случай, если нужны отдельно) |
| `out/vo-timing.txt` | тайминг озвучки: какую фразу на какой секунде начинать |
| `index.html` + `scene.js` | исходник анимации, открывается в браузере с плеером |
| `render.mjs`, `sfx.py` | рендер в MP4 и синтез эффектов |

## Как посмотреть превью

```bash
npx serve .            # или любой статический сервер
# открыть http://localhost:3000/?channel=@mychannel
```

Пробел — пауза, стрелки — покадрово, кнопка Zones показывает зоны интерфейса YouTube
(верхние 10 % и нижние 20 %) и зону субтитров.

## Озвучка

Субтитры и анимация привязаны к таймингу из `out/vo-timing.txt`:

```
00:00:00,300 – 00:00:05,600  For years, a chatbot was the one thing you could insult without worrying about getting hit.
00:00:05,900 – 00:00:09,500  It would probably just apologize or ask you to calm down.
00:00:09,900 – 00:00:11,800  But that might be changing.
00:00:12,300 – 00:00:19,800  Anthropic has given some of its Claude models the ability to end a conversation in rare, extreme cases of persistent abuse.
00:00:20,200 – 00:00:25,100  It only happens after the AI has tried to steer the chat somewhere else.
00:00:25,600 – 00:00:31,600  After that, you can’t send more messages in that chat, but you can start a new one.
00:00:32,200 – 00:00:35,500  Anthropic says it’s part of its research into AI welfare.
00:00:36,000 – 00:00:39,900  So if you snap at a chatbot once or twice, nothing happens.
00:00:40,700 – 00:00:44,100  But keep going, and it might simply say goodbye.
```

Два способа:

1. **Подогнать голос под видео.** Сгенерировать каждую фразу отдельно и поставить её в
   редакторе на указанный таймкод. Если фраза выходит длиннее окна, ускорить её на 5–10 %.
2. **Подогнать видео под голос.** Записать голос целиком, посмотреть, где начинается и
   заканчивается каждая фраза, и поправить `s` / `e` в массиве `VO` в начале `scene.js`.
   Вся анимация и подсветка слов привязаны к этим числам и сдвинутся сами. Потом
   перерендерить (см. ниже) с `--voice`, и голос сразу смешается с эффектами.

## Рендер

Нужны Node 18+, Python 3 с numpy, ffmpeg и Chromium для Playwright.

```bash
npm install
npx playwright install chromium          # один раз
node render.mjs --channel "@mychannel"   # видео + эффекты
node render.mjs --channel "@mychannel" --voice vo.wav --music lofi.mp3
```

`--music` ставит подложку на 15 % громкости и делает затухание в конце.
`--stills 3,12.5,26` сохраняет отдельные кадры в `out/` для проверки.

## Сверка с источником

Формулировки совпадают с сообщением Anthropic (август 2025): функция есть у Claude Opus 4
и 4.1, срабатывает «в редких, крайних случаях устойчиво вредного или оскорбительного
поведения», только после нескольких неудачных попыток перевести разговор. После этого
нельзя писать в этот чат, но можно начать новый (а также отредактировать и переотправить
прежние сообщения). Anthropic называет это частью исследовательской работы о
возможном благополучии (welfare) моделей. Перед публикацией стоит ещё раз открыть
пост и проверить.
