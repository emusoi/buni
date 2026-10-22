package app.emusoi.buni

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke as Line
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

// The architecture views, drawn in map units from the layout the Mac sends: the same boxes and links the editor shows.

private val dash = PathEffect.dashPathEffect(floatArrayOf(5f, 4f))

private fun DrawScope.card(r: Rect, planned: Boolean, lit: Boolean, p: Palette, flash: Boolean = false) {
    val radius = CornerRadius(10f)
    if (flash) drawRoundRect(p.accent.copy(alpha = .28f), r.topLeft - Offset(6f, 6f), Size(r.width + 12f, r.height + 12f), CornerRadius(15f))
    if (planned) {
        drawRoundRect(p.tealTint, r.topLeft, r.size, radius)
        dashedBox(p.teal, r.topLeft, r.size, 10f, 1.5f, 5f)
    } else {
        drawRoundRect(p.surface, r.topLeft, r.size, radius)
        drawRoundRect(if (lit) p.accent else p.line, r.topLeft, r.size, radius, style = Line(width = if (lit) 1.5f else 1f))
        if (lit) drawRoundRect(p.accentTint, r.topLeft - Offset(4f, 4f), Size(r.width + 8f, r.height + 8f), CornerRadius(13f), style = Line(4f))
    }
}

private fun DrawScope.arrowhead(a: Offset, b: Offset, c: Color, scale: Float = 1f) {
    val ang = atan2(b.y - a.y, b.x - a.x)
    val l = 7f * scale
    val path = Path().apply {
        moveTo(b.x, b.y)
        lineTo(b.x - l * cos(ang - 0.45f), b.y - l * sin(ang - 0.45f))
        lineTo(b.x - l * cos(ang + 0.45f), b.y - l * sin(ang + 0.45f))
        close()
    }
    drawPath(path, c)
}

/** `proposed`: ids a waiting plan adds (labelled as Claude's); `flash`: ids just accepted, lit for a moment. */
fun DrawScope.drawMap(m: MapData, p: Palette, tm: TextMeasurer, selected: String?, proposed: Set<String> = emptySet(), flash: Set<String> = emptySet()) {
    for (f in m.frames) {
        dashedBox(p.ink3.copy(alpha = .5f), Offset(f.x, f.y), Size(f.w, f.h), 14f, 1f, 5f)
        drawRect(p.canvas, Offset(f.x + 12f, f.y - 9f), Size(f.title.length * 6.6f + 10f, 18f))
        text(tm, f.title, Offset(f.x + 16f, f.y - 8f), 12f, p.ink2, width = f.w - 24f, lines = 1)
    }
    for (l in m.links) {
        if (l.points.size < 2) continue
        val planned = l.tone == "planned"
        val c = if (planned) p.teal else p.ink3
        val path = Path().apply { moveTo(l.points[0].x, l.points[0].y); for (pt in l.points.drop(1)) lineTo(pt.x, pt.y) }
        drawPath(path, c, style = Line(width = 1.4f, pathEffect = if (planned) dash else null))
        arrowhead(l.points[l.points.size - 2], l.points.last(), c)
    }
    for (l in m.links) {
        val at = l.at ?: continue
        val label = l.label ?: continue
        val w = label.length * 6.4f + 12f
        drawRoundRect(p.canvas, Offset(at.x - w / 2, at.y - 9f), Size(w, 18f), CornerRadius(4f))
        text(tm, label, Offset(at.x - w / 2 + 6f, at.y - 8f), 12f, if (l.tone == "planned") p.teal else p.ink2, width = w, lines = 1)
    }
    for (b in m.boxes) {
        val planned = b.tone == "planned"
        card(Rect(b.x, b.y, b.x + b.w, b.y + b.h), planned, b.ids.contains(selected), p, b.ids.any { it in flash })
        val tc = if (planned) p.teal else p.ink
        text(tm, if (planned && b.ids.any { it in proposed }) "Proposed by Claude" else b.label, Offset(b.x + 12f, b.y + 9f), 12f, if (planned) p.teal else p.ink3, width = b.w - 24f, lines = 1)
        text(tm, b.name, Offset(b.x + 12f, b.y + 26f), 14f, tc, bold = true, width = b.w - 24f, lines = 2)
        b.sub?.let { text(tm, it, Offset(b.x + 12f, b.y + 46f), 12f, p.ink2, width = b.w - 24f, lines = 2) }
    }
}

/**
 * A flow: each screen as the Mac drew it, cropped to its box; the usual path's arrows named by what the person taps,
 * the others dashed. Under each step its journey: confidence, feeling, risk, outlined amber when confidence is 3 or
 * less. Above each other screen its name and what sends people there; under it, the step it leads back to.
 * `selected`: the screen whose journey is open.
 */
fun DrawScope.drawFlow(f: Flow, p: Palette, tm: TextMeasurer, images: Map<String, ImageBitmap>, selected: String?) {
    for (l in f.links) {
        if (l.points.size < 2) continue
        val path = Path().apply { moveTo(l.points[0].x, l.points[0].y); for (pt in l.points.drop(1)) lineTo(pt.x, pt.y) }
        drawPath(path, p.ink3, style = Line(width = 1.4f, pathEffect = if (l.condition) dash else null))
        arrowhead(l.points[l.points.size - 2], l.points.last(), p.ink3)
    }
    for (s in f.screens) {
        val r = Rect(s.x, s.y, s.x + s.w, s.y + s.h)
        val lit = s.page == selected
        if (s.step != null) {
            drawCircle(p.ink, 10f, Offset(s.x + 10f, s.y - 18f))
            text(tm, "${s.step}", Offset(s.x + (if (s.step < 10) 6.5f else 3f), s.y - 26f), 12f, p.canvas, bold = true, width = 20f, lines = 1)
            text(tm, s.name, Offset(s.x + 26f, s.y - 28f), 15f, p.ink, bold = true, width = s.w + 80f, lines = 1)
        } else {
            text(tm, s.name, Offset(s.x - 2f, s.y - 46f), 12f, p.ink, bold = true, width = s.w + 12f, lines = 1)
            s.whenIt?.let { text(tm, it, Offset(s.x - 2f, s.y - 30f), 10f, p.ink2, width = s.w + 12f, lines = 2) }
            s.back?.let { back ->
                val y = s.y + s.h + 12f
                drawPath(Path().apply { moveTo(s.x + 9f, y + 4f); lineTo(s.x + 3f, y + 4f); lineTo(s.x + 3f, y - 2f); moveTo(s.x + 1f, y); lineTo(s.x + 3f, y - 3f); lineTo(s.x + 5f, y) }, p.ink2, style = Line(1.2f))
                text(tm, back, Offset(s.x + 13f, y - 4f), 11f, p.ink2, width = s.w, lines = 1)
            }
        }
        drawRoundRect(p.surface, r.topLeft, r.size, CornerRadius(8f))
        images[s.page]?.let { img ->
            val srcH = minOf(img.height, (img.width * s.h / s.w).toInt())
            drawImage(img, IntOffset.Zero, IntSize(img.width, srcH), IntOffset(s.x.toInt(), s.y.toInt()), IntSize(s.w.toInt(), s.h.toInt()))
        }
        drawRoundRect(if (lit) p.accent else p.line, r.topLeft, r.size, CornerRadius(8f), style = Line(width = if (lit) 3f else 1f))
        s.card?.let { c -> f.journey.firstOrNull { it.page == s.page }?.let { j -> journeyCard(c, j, f.lanes, p, tm) } }
    }
    // The usual path's labels last, over its arrows.
    for (l in f.links) {
        val at = l.at ?: continue
        if (l.condition || l.label.isEmpty()) continue
        val w = minOf(l.label.length * 6.4f + 12f, 220f)
        drawRoundRect(p.canvas, Offset(at.x - w / 2, at.y - 10f), Size(w, 20f), CornerRadius(5f))
        drawRoundRect(p.line, Offset(at.x - w / 2, at.y - 10f), Size(w, 20f), CornerRadius(5f), style = Line(1f))
        text(tm, l.label, Offset(at.x - w / 2 + 6f, at.y - 8f), 12f, p.ink, width = w - 12f, lines = 1)
    }
}

/** A step's journey under it: how sure we are people get through it, how they feel, and what could go wrong. */
private fun DrawScope.journeyCard(c: Rect, j: JourneyStep, lanes: List<String>, p: Palette, tm: TextMeasurer) {
    val weak = (j.confidence ?: 5) <= 3
    drawRoundRect(p.surface, c.topLeft, c.size, CornerRadius(10f))
    drawRoundRect(if (weak) p.amber else p.line, c.topLeft, c.size, CornerRadius(10f), style = Line(if (weak) 1.5f else 1f))
    j.confidence?.let { n ->
        for (i in 0 until 5) drawCircle(if (i < n) p.accent else p.fill, 3.5f, Offset(c.left + 14f + i * 10f, c.top + 13f))
        text(tm, "$n of 5", Offset(c.left + 66f, c.top + 6f), 11f, p.ink2, width = 60f, lines = 1)
    }
    val feeling = lanes.firstOrNull { it.equals("Feeling", true) }?.let { j.cells[it] }
    val risk = lanes.firstOrNull { it.equals("Risk", true) }?.let { j.cells[it] }
    feeling?.let { text(tm, it, Offset(c.left + 10f, c.top + 24f), 12f, p.ink, width = c.width - 20f, lines = 2) }
    risk?.let {
        val y = c.top + 62f
        drawPath(Path().apply { moveTo(c.left + 15f, y); lineTo(c.left + 20f, y + 9f); lineTo(c.left + 10f, y + 9f); close() }, p.red, style = Line(1.2f))
        text(tm, it, Offset(c.left + 24f, y - 2f), 11f, p.red, bold = true, width = c.width - 34f, lines = 2)
    }
}

/**
 * The Screens canvas as the editor lays it out: each row titled with its flow, every page as the Mac drew it, and the
 * links of `selected`, the page last tapped, as the editor shows the active page's. `u` is a dp in canvas units: links
 * and their labels stay the same size on screen at any zoom, as in the editor.
 */
fun DrawScope.drawCanvas(c: CanvasData, p: Palette, tm: TextMeasurer, images: Map<String, ImageBitmap>, selected: String?, u: Float) {
    for (t in c.titles) {
        text(tm, t.name, Offset(t.x - 240f, t.y), 18f, p.ink, bold = true, width = 216f, lines = 2)
        text(tm, "${t.pages} pages", Offset(t.x - 240f, t.y + 26f), 13f, p.ink2, width = 216f, lines = 1)
    }
    for (b in c.boards) {
        val lit = b.page == selected
        text(tm, b.name, Offset(b.x, b.y - 22f), 13f, if (lit) p.accentText else p.ink2, bold = lit, width = b.w, lines = 1)
        drawRect(p.surface, Offset(b.x, b.y), Size(b.w, b.h))
        images[b.page]?.let { drawImage(it, IntOffset.Zero, IntSize(it.width, it.height), IntOffset(b.x.toInt(), b.y.toInt()), IntSize(b.w.toInt(), b.h.toInt())) }
        drawRect(if (lit) p.accent else p.line, Offset(b.x, b.y), Size(b.w, b.h), style = Line(width = if (lit) 3f else 1f))
    }
    // As in the editor: the selected page's links only, those leaving it lit and named, those coming in grey.
    for (l in c.links.filter { it.from == selected || it.to == selected }.sortedBy { it.from == selected }) {
        val on = l.from == selected
        // Built point by point: H and V keep the other coordinate of where the line is.
        var x = 0f; var y = 0f; var before = Offset.Zero
        val path = Path()
        for ((cmd, n) in l.path) {
            before = Offset(x, y)
            when (cmd) {
                'M' -> { x = n[0]; y = n[1]; path.moveTo(x, y) }
                'L' -> { x = n[0]; y = n[1]; path.lineTo(x, y) }
                'H' -> { x = n[0]; path.lineTo(x, y) }
                'V' -> { y = n[0]; path.lineTo(x, y) }
                'Q' -> { path.quadraticTo(n[0], n[1], n[2], n[3]); before = Offset(n[0], n[1]); x = n[2]; y = n[3] }
            }
        }
        val color = if (on) p.accent else p.ink3
        drawPath(path, color, style = Line(width = (if (on) 2f else 1.5f) * u))
        arrowhead(before, Offset(x, y), color, u)
        l.dot?.let { drawCircle(color, 4f * u, it) }
        if (on) l.at?.let { at -> if (l.label.isNotEmpty()) {
            val w = minOf(l.label.length * 7f + 12f, 260f) * u
            drawRoundRect(p.canvas, Offset(at.x - 2f * u, at.y - 16f * u), Size(w, 20f * u), CornerRadius(5f * u))
            text(tm, l.label, Offset(at.x + 4f * u, at.y - 14f * u), 12f * u, p.accentText, bold = true, width = w - 8f * u, lines = 1)
        } }
    }
}

/**
 * A tag over each sketch of a new screen: strokes close together are one sketch drawn in several goes. Built ones
 * (Claude answered) say so.
 */
fun DrawScope.sketchTags(sketches: List<Mark>, p: Palette, tm: TextMeasurer, u: Float) {
    val groups = mutableListOf<Pair<Rect, Boolean>>()
    for (m in sketches) {
        var r = markBounds(m)
        var built = m.state == "addressed"
        // Folds in every group this one touches, so a sketch in five goes gets one tag.
        groups.removeAll { (g, b) -> g.inflate(40f * u).overlaps(r).also { if (it) { r = Rect(minOf(g.left, r.left), minOf(g.top, r.top), maxOf(g.right, r.right), maxOf(g.bottom, r.bottom)); built = built && b } } }
        groups += r to built
    }
    for ((r, built) in groups) {
        val words = if (built) "Built by Claude" else "New screen · sketch"
        val w = (words.length * 7f + 20f) * u
        val at = Offset(r.left, r.top - 30f * u)
        drawRoundRect(if (built) p.tealTint else p.accentTint, at, Size(w, 22f * u), CornerRadius(11f * u))
        text(tm, words, at + Offset(10f * u, 3f * u), 12f * u, if (built) p.teal else p.accentText, bold = true, width = w, lines = 1)
    }
}

/** The page of the screen under a point on a flow. */
fun flowScreenAt(f: Flow?, at: Offset): String? = f?.screens?.lastOrNull { at.x in it.x..(it.x + it.w) && at.y in it.y..(it.y + it.h) }?.page

/** The id of the box under a point, for a mark's `on`. */
fun boxAt(m: MapData?, at: Offset): String? = m?.boxes?.lastOrNull { at.x in it.x..(it.x + it.w) && at.y in it.y..(it.y + it.h) }?.ids?.firstOrNull()

private val METHOD = mapOf("GET" to (Color(0xFF2F6A4A) to Color(0xFFE3EEE7)), "POST" to (Color(0xFF34458A) to Color(0xFFE6E9F5)),
    "PUT" to (Color(0xFF8A4F0E) to Color(0xFFFBF3E6)), "PATCH" to (Color(0xFF8A4F0E) to Color(0xFFFBF3E6)), "DELETE" to (Color(0xFF9A2A1F) to Color(0xFFFBEEEC)))

fun DrawScope.drawApi(a: ApiData, p: Palette, tm: TextMeasurer, picked: String?) {
    val rows = a.cards.flatMap { c -> c.rows.map { it.op to (c to it) } }.toMap()
    for (caller in a.callers) for (to in caller.to) {
        val card = a.cards.firstOrNull { it.part == to } ?: continue
        val s = Offset(caller.x + caller.w, caller.y + 32f)
        val e = Offset(card.x, card.y + 26f)
        val mid = s.x + 24f
        drawPath(Path().apply { moveTo(s.x, s.y); lineTo(mid, s.y); lineTo(mid, e.y); lineTo(e.x, e.y) }, p.ink3, style = Line(1.3f))
    }
    for ((from, to) in a.resolves) {
        val (fc, fr) = rows[from] ?: continue
        val (tc, tr) = rows[to] ?: continue
        val lit = picked == from || picked == to
        val s = Offset(fc.x + fc.w, fr.y + fr.h / 2)
        val e = Offset(tc.x, tr.y + tr.h / 2)
        val bend = (s.x + e.x) / 2
        drawPath(Path().apply { moveTo(s.x, s.y); cubicTo(bend, s.y, bend, e.y, e.x, e.y) }, if (lit) p.accent else p.ink3, style = Line(if (lit) 2f else 1.3f, cap = StrokeCap.Round))
    }
    for (c in a.callers) {
        card(Rect(c.x, c.y, c.x + c.w, c.y + c.h), false, false, p)
        text(tm, c.label ?: "", Offset(c.x + 12f, c.y + 9f), 12f, p.ink3, width = c.w - 24f, lines = 1)
        text(tm, c.name, Offset(c.x + 12f, c.y + 26f), 14f, p.ink, bold = true, width = c.w - 24f, lines = 1)
        c.sub?.let { text(tm, it, Offset(c.x + 12f, c.y + 46f), 12f, p.ink2, width = c.w - 24f) }
    }
    for (c in a.cards) {
        drawRoundRect(p.surface, Offset(c.x, c.y), Size(c.w, c.h), CornerRadius(14f))
        drawRoundRect(p.line, Offset(c.x, c.y), Size(c.w, c.h), CornerRadius(14f), style = Line(1f))
        text(tm, "${if (c.kind == "rest") "REST" else "GraphQL"} · ${c.name}", Offset(c.x + 14f, c.y + 10f), 12f, p.ink3, width = c.w - 28f, lines = 1)
        text(tm, c.spec ?: if (c.kind == "rest") "openapi.yaml" else "schema.graphql", Offset(c.x + 14f, c.y + 26f), 15f, p.ink, bold = true, width = c.w - 28f, lines = 1)
        for ((label, y) in c.sections) text(tm, label, Offset(c.x + 14f, y + 8f), 12f, p.ink3, width = c.w - 28f, lines = 1)
        for (r in c.rows) {
            if (r.op == picked) {
                drawRect(p.accentTint, Offset(c.x + 1f, r.y), Size(c.w - 2f, r.h))
                drawRect(p.accent, Offset(c.x + 1f, r.y), Size(3f, r.h))
            }
            drawLine(p.line, Offset(c.x, r.y), Offset(c.x + c.w, r.y), 1f)
            val cy = r.y + r.h / 2
            var x = c.x + 14f
            r.method?.let { m ->
                val (fg, bg) = METHOD[m] ?: (p.ink2 to p.fill)
                drawRoundRect(if (p.dark) fg.copy(alpha = .22f) else bg, Offset(x, cy - 9f), Size(46f, 18f), CornerRadius(4f))
                text(tm, m, Offset(x + 23f - m.length * 3.4f, cy - 8f), 11f, if (p.dark) bg else fg, bold = true, width = 46f, lines = 1, mono = true)
                x += 56f
            }
            text(tm, r.path ?: r.field ?: "", Offset(x, cy - 9f), 14f, p.ink, width = c.x + c.w - x - 60f, lines = 1, mono = true)
            (r.returns ?: r.note)?.let { text(tm, it, Offset(c.x + c.w - 70f, cy - 8f), 12f, p.ink2, width = 60f, lines = 1, mono = r.returns != null) }
        }
    }
}

fun apiRowAt(a: ApiData?, at: Offset): ApiRow? = a?.cards?.firstNotNullOfOrNull { c ->
    if (at.x !in c.x..(c.x + c.w)) null else c.rows.firstOrNull { at.y in it.y..(it.y + it.h) }
}

fun apiOnAt(a: ApiData?, at: Offset): String? = apiRowAt(a, at)?.op
    ?: a?.cards?.firstOrNull { at.x in it.x..(it.x + it.w) && at.y in it.y..(it.y + it.h) }?.part
    ?: a?.callers?.firstOrNull { at.x in it.x..(it.x + it.w) && at.y in it.y..(it.y + it.h) }?.id
