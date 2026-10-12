// Pixel Crab — 2s loop for After Effects 2022
// Запуск: File > Scripts > Run Script File... и выбрать этот файл.
// Создаёт композицию "Pixel Crab" 1080x1080, 30 fps, 2 сек, прозрачный фон.

(function () {
    var P = 40;                       // размер одного "пикселя" в px
    var W = 1080, H = 1080, FPS = 30, DUR = 2;
    var BEAT = 0.25;                  // шаг анимации (8 битов на луп)
    var ORANGE = [215 / 255, 119 / 255, 87 / 255];
    var BLACK = [0, 0, 0];

    // Сетка крабика: 13 x 8 клеток
    //   . . # # # # # # # # # . .   строка 0  тело
    //   . . # E # # # # # E # . .   строка 1  глаза
    //   # # # # # # # # # # # # #   строка 2  тело + клешни
    //   # # # # # # # # # # # # #   строка 3
    //   . . # # # # # # # # # . .   строка 4
    //   . . # # # # # # # # # . .   строка 5
    //   . . . L . L . L . L . . .   строки 6-7 ноги
    var GRID_W = 13, GRID_H = 8;
    var OX = Math.round((W - GRID_W * P) / 2);
    var OY = Math.round((H - GRID_H * P) / 2);

    app.beginUndoGroup("Pixel Crab");

    var comp = app.project.items.addComp("Pixel Crab", W, H, 1, DUR, FPS);
    comp.bgColor = [0.96, 0.94, 0.90];
    comp.openInViewer();

    // rects: массив [col, row, wCells, hCells]
    function pixelLayer(name, rects, color) {
        var layer = comp.layers.addShape();
        layer.name = name;
        layer.property("ADBE Transform Group").property("ADBE Position").setValue([OX, OY]);
        var root = layer.property("ADBE Root Vectors Group");
        var grp = root.addProperty("ADBE Vector Group");
        grp.name = name;
        var c = grp.property("ADBE Vectors Group");
        for (var i = 0; i < rects.length; i++) {
            var r = rects[i];
            var rect = c.addProperty("ADBE Vector Shape - Rect");
            rect.property("ADBE Vector Rect Size").setValue([r[2] * P, r[3] * P]);
            rect.property("ADBE Vector Rect Position").setValue([(r[0] + r[2] / 2) * P, (r[1] + r[3] / 2) * P]);
        }
        var fill = c.addProperty("ADBE Vector Graphic - Fill");
        fill.property("ADBE Vector Fill Color").setValue(color);
        return layer;
    }

    // Ступенчатые (HOLD) ключи + loopOut, чтобы луп работал и при удлинении прекомпа.
    // values: массив значений по битам; в конце (t = DUR) ставится значение бита 0.
    function stepAnim(prop, values) {
        for (var i = 0; i < values.length; i++) prop.setValueAtTime(i * BEAT, values[i]);
        prop.setValueAtTime(DUR, values[0]);
        for (var k = 1; k <= prop.numKeys; k++) {
            prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
        }
        prop.expression = 'loopOut("cycle")';
    }

    function offsetY(cells) { return [OX, OY + cells * P]; }

    // Слои создаются снизу вверх: каждый новый слой встаёт наверх стека
    var legsA = pixelLayer("Legs A", [[3, 6, 1, 2], [7, 6, 1, 2]], ORANGE);
    var legsB = pixelLayer("Legs B", [[5, 6, 1, 2], [9, 6, 1, 2]], ORANGE);
    var armL  = pixelLayer("Claw L", [[0, 2, 2, 2]], ORANGE);
    var armR  = pixelLayer("Claw R", [[11, 2, 2, 2]], ORANGE);
    var body  = pixelLayer("Body",   [[2, 0, 9, 6]], ORANGE);
    var eyes  = pixelLayer("Eyes",   [[3, 1, 1, 1], [9, 1, 1, 1]], BLACK);

    var POS = "ADBE Position";
    function pos(l) { return l.property("ADBE Transform Group").property(POS); }

    // Ноги перебирают по очереди: поднятая нога прячется под тело на 1 клетку
    stepAnim(pos(legsA), [offsetY(-1), offsetY(0), offsetY(-1), offsetY(0), offsetY(-1), offsetY(0), offsetY(-1), offsetY(0)]);
    stepAnim(pos(legsB), [offsetY(0), offsetY(-1), offsetY(0), offsetY(-1), offsetY(0), offsetY(-1), offsetY(0), offsetY(-1)]);

    // Клешни машут по очереди
    stepAnim(pos(armL), [offsetY(0), offsetY(-1), offsetY(0), offsetY(0), offsetY(0), offsetY(-1), offsetY(0), offsetY(0)]);
    stepAnim(pos(armR), [offsetY(0), offsetY(0), offsetY(0), offsetY(-1), offsetY(0), offsetY(0), offsetY(0), offsetY(-1)]);

    // Моргание: глаза пропадают на 4 кадра примерно на 1.5 сек
    var op = eyes.property("ADBE Transform Group").property("ADBE Opacity");
    op.setValueAtTime(0, 100);
    op.setValueAtTime(44 / FPS, 0);
    op.setValueAtTime(48 / FPS, 100);
    op.setValueAtTime(DUR, 100);
    for (var k = 1; k <= op.numKeys; k++) {
        op.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
    }
    op.expression = 'loopOut("cycle")';

    app.endUndoGroup();
})();
