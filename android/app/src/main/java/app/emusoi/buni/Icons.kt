package app.emusoi.buni

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke as Line
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Line icons drawn on a 24-unit grid, Lucide-like, so the app needs no icon library. */
enum class Glyph { Pen, Highlighter, Eraser, Lasso, Note, Undo, Redo, Cable, Back, Check, Sparkles, Users, Boxes, Braces, Screens, Chevron, Close, Checklist, More, Minus, Plus, Fit, Hand, Bulb, Contrast, Unplug, Grid, Down, Route, Play }

@Composable
fun Icon(g: Glyph, color: Color, size: Dp = 22.dp) {
    Canvas(Modifier.size(size)) {
        val u = this.size.minDimension / 24f
        val s = Line(width = 1.8f * u, cap = StrokeCap.Round, join = StrokeJoin.Round)
        fun p(vararg pts: Float): Path = Path().apply { moveTo(pts[0] * u, pts[1] * u); var i = 2; while (i < pts.size) { lineTo(pts[i] * u, pts[i + 1] * u); i += 2 } }
        fun line(vararg pts: Float) = drawPath(p(*pts), color, style = s)
        fun box(x: Float, y: Float, w: Float, h: Float, r: Float = 2f) = drawRoundRect(color, Offset(x * u, y * u), Size(w * u, h * u), CornerRadius(r * u), style = s)
        when (g) {
            Glyph.Pen -> { line(4f, 20f, 8f, 19f, 19f, 8f, 16f, 5f, 5f, 16f, 4f, 20f); line(14f, 7f, 17f, 10f) }
            Glyph.Highlighter -> { line(9f, 11f, 3f, 17f, 3f, 21f, 7f, 21f, 13f, 15f); line(9f, 11f, 15f, 5f, 19f, 9f, 13f, 15f, 9f, 11f) }
            Glyph.Eraser -> { line(7f, 21f, 3f, 17f, 13f, 7f, 19f, 13f, 11f, 21f, 7f, 21f); line(21f, 21f, 7f, 21f); line(8f, 12f, 14f, 18f) }
            Glyph.Lasso -> { drawOval(color, Offset(4f * u, 4f * u), Size(16f * u, 10f * u), style = s); line(8f, 13f, 8f, 18f, 11f, 21f) }
            Glyph.Note -> { line(5f, 5f, 19f, 5f); line(12f, 5f, 12f, 20f); line(9f, 20f, 15f, 20f) }
            Glyph.Undo -> { line(9f, 14f, 4f, 9f, 9f, 4f); drawPath(Path().apply { moveTo(4f * u, 9f * u); lineTo(15f * u, 9f * u); cubicTo(22f * u, 9f * u, 22f * u, 20f * u, 15f * u, 20f * u); lineTo(10f * u, 20f * u) }, color, style = s) }
            Glyph.Redo -> { line(15f, 14f, 20f, 9f, 15f, 4f); drawPath(Path().apply { moveTo(20f * u, 9f * u); lineTo(9f * u, 9f * u); cubicTo(2f * u, 9f * u, 2f * u, 20f * u, 9f * u, 20f * u); lineTo(14f * u, 20f * u) }, color, style = s) }
            Glyph.Cable -> { line(4f, 9f, 4f, 3f); line(8f, 9f, 8f, 3f); box(2f, 9f, 8f, 5f, 1f); drawPath(Path().apply { moveTo(6f * u, 14f * u); lineTo(6f * u, 17f * u); cubicTo(6f * u, 22f * u, 18f * u, 22f * u, 18f * u, 17f * u); lineTo(18f * u, 11f * u) }, color, style = s); box(15f, 6f, 6f, 5f, 1f) }
            Glyph.Back -> line(15f, 18f, 9f, 12f, 15f, 6f)
            Glyph.Chevron -> line(9f, 18f, 15f, 12f, 9f, 6f)
            Glyph.Check -> line(20f, 6f, 9f, 17f, 4f, 12f)
            Glyph.Close -> { line(18f, 6f, 6f, 18f); line(6f, 6f, 18f, 18f) }
            Glyph.Sparkles -> { line(12f, 3f, 13.5f, 9f, 20f, 10.5f, 13.5f, 12f, 12f, 18f, 10.5f, 12f, 4f, 10.5f, 10.5f, 9f, 12f, 3f); line(19f, 17f, 19f, 21f); line(17f, 19f, 21f, 19f) }
            Glyph.Users -> { drawCircle(color, 4f * u, Offset(9f * u, 8f * u), style = s); drawPath(Path().apply { moveTo(2f * u, 21f * u); cubicTo(2f * u, 15f * u, 16f * u, 15f * u, 16f * u, 21f * u) }, color, style = s); line(16f, 4f, 18f, 5f, 18f, 11f, 16f, 12f) }
            Glyph.Boxes -> { box(3f, 3f, 8f, 8f); box(13f, 3f, 8f, 8f); box(8f, 13f, 8f, 8f) }
            Glyph.Braces -> { drawPath(Path().apply { moveTo(8f * u, 3f * u); cubicTo(5f * u, 3f * u, 6f * u, 10f * u, 3f * u, 12f * u); cubicTo(6f * u, 14f * u, 5f * u, 21f * u, 8f * u, 21f * u); moveTo(16f * u, 3f * u); cubicTo(19f * u, 3f * u, 18f * u, 10f * u, 21f * u, 12f * u); cubicTo(18f * u, 14f * u, 19f * u, 21f * u, 16f * u, 21f * u) }, color, style = s) }
            Glyph.Checklist -> { line(3f, 6f, 5f, 8f, 8f, 4f); line(3f, 13f, 5f, 15f, 8f, 11f); line(11f, 6f, 21f, 6f); line(11f, 12f, 21f, 12f); line(11f, 18f, 21f, 18f); line(4f, 18f, 7f, 18f) }
            Glyph.More -> for (x in listOf(5f, 12f, 19f)) drawCircle(color, 1.6f * u, Offset(x * u, 12f * u))
            Glyph.Minus -> line(5f, 12f, 19f, 12f)
            Glyph.Plus -> { line(5f, 12f, 19f, 12f); line(12f, 5f, 12f, 19f) }
            Glyph.Fit -> { line(15f, 3f, 21f, 3f, 21f, 9f); line(21f, 3f, 14f, 10f); line(9f, 21f, 3f, 21f, 3f, 15f); line(3f, 21f, 10f, 14f) }
            Glyph.Hand -> { line(8f, 13f, 8f, 5f); line(11f, 11f, 11f, 3f); line(14f, 11f, 14f, 4f); line(17f, 12f, 17f, 7f); drawPath(Path().apply { moveTo(17f * u, 12f * u); lineTo(17f * u, 15f * u); cubicTo(17f * u, 19f * u, 14f * u, 21f * u, 11f * u, 21f * u); cubicTo(8f * u, 21f * u, 6f * u, 19f * u, 4f * u, 15f * u); lineTo(3f * u, 12f * u); cubicTo(4f * u, 11f * u, 6f * u, 11f * u, 8f * u, 13f * u) }, color, style = s) }
            Glyph.Bulb -> { drawPath(Path().apply { moveTo(9f * u, 17f * u); cubicTo(9f * u, 14f * u, 5f * u, 13f * u, 5f * u, 9f * u); cubicTo(5f * u, 1f * u, 19f * u, 1f * u, 19f * u, 9f * u); cubicTo(19f * u, 13f * u, 15f * u, 14f * u, 15f * u, 17f * u); close() }, color, style = s); line(9f, 21f, 15f, 21f) }
            Glyph.Contrast -> { drawCircle(color, 8f * u, Offset(12f * u, 12f * u), style = s); drawArc(color, -90f, 180f, true, Offset(4f * u, 4f * u), Size(16f * u, 16f * u)) }
            Glyph.Unplug -> { line(3f, 21f, 7f, 17f); line(21f, 3f, 17f, 7f); box(6f, 11f, 7f, 7f, 2f); box(11f, 6f, 7f, 7f, 2f); line(4f, 4f, 20f, 20f) }
            Glyph.Grid -> { box(3f, 3f, 7f, 7f); box(14f, 3f, 7f, 7f); box(3f, 14f, 7f, 7f); box(14f, 14f, 7f, 7f) }
            Glyph.Down -> line(6f, 9f, 12f, 15f, 18f, 9f)
            Glyph.Screens -> { box(3f, 3f, 18f, 18f); line(3f, 9f, 21f, 9f); line(9f, 9f, 9f, 21f) }
            Glyph.Play -> drawPath(Path().apply { moveTo(7f * u, 4f * u); lineTo(19f * u, 12f * u); lineTo(7f * u, 20f * u); close() }, color, style = s)
            Glyph.Route -> { drawCircle(color, 3f * u, Offset(6f * u, 19f * u), style = s); drawCircle(color, 3f * u, Offset(18f * u, 5f * u), style = s); drawPath(Path().apply { moveTo(9f * u, 19f * u); lineTo(17.5f * u, 19f * u); cubicTo(21f * u, 19f * u, 21f * u, 12f * u, 17.5f * u, 12f * u); lineTo(6.5f * u, 12f * u); cubicTo(3f * u, 12f * u, 3f * u, 5f * u, 6.5f * u, 5f * u); lineTo(15f * u, 5f * u) }, color, style = s) }
        }
    }
}

/** A dashed rounded rectangle, the planned tone's outline. */
fun DrawScope.dashedBox(color: Color, topLeft: Offset, size: Size, radius: Float, width: Float, dash: Float) {
    drawRoundRect(color, topLeft, size, CornerRadius(radius), style = Line(width = width, pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(dash, dash * 0.8f))))
}
