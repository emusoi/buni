package app.emusoi.buni

import android.graphics.Bitmap
import android.util.Base64
import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateDecay
import androidx.compose.animation.core.FloatExponentialDecaySpec
import androidx.compose.animation.core.spring
import androidx.compose.foundation.border
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.LocalView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke as Line
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

enum class Tool { Pen, Highlighter, Eraser, Lasso, Note }

/** The pen's state, shared by the rail (which sets it) and the board (which draws with it). */
/** Where strokes drawn on the canvas are kept: on a page in its pixels, or as a sketch of a new screen. */
data class Placed(val view: String, val page: String?, val strokes: List<Stroke>)

class InkState {
    var tool by mutableStateOf(Tool.Pen)
        private set
    /** The tool before this one: a click of the pen's button goes back to it. */
    private var previous = Tool.Eraser
    var color by mutableStateOf("#d70015")
    /** Marks this tablet saved, newest last: what undo takes back. */
    val mine = mutableStateListOf<String>()
    val undone = mutableStateListOf<Triple<List<Stroke>, String?, String?>>()
    val pending = mutableStateListOf<Stroke>()
    val canUndo get() = pending.isNotEmpty() || mine.isNotEmpty()
    /**
     * On the Screens canvas: which page strokes drawn there belong to, and the strokes in that page's own pixels. A
     * mark there is an ordinary page mark, so the editor shows it on its page.
     */
    var placeOn: ((List<Stroke>) -> Placed)? = null

    fun pick(t: Tool) { if (t != tool) { previous = tool; tool = t } }
    fun swap() = pick(previous)
}

const val HIGHLIGHT = "#facc15"
private const val SETTLE_MS = 1_200L

/** Draws content units onto the screen: x' = x * k + off. */
data class ViewXf(val off: Offset = Offset.Zero, val k: Float = 1f) {
    fun toContent(p: Offset) = Offset((p.x - off.x) / k, (p.y - off.y) / k)
}

/** A smooth path through a stroke's points, as the Mac draws them (src/tools/ink.ts). */
fun strokePath(pts: FloatArray): Path = Path().apply {
    val n = pts.size / 2
    if (n == 0) return@apply
    moveTo(pts[0], pts[1])
    if (n == 1) { lineTo(pts[0] + 0.01f, pts[1]); return@apply }
    for (i in 1 until n - 1) quadraticTo(pts[i * 2], pts[i * 2 + 1], (pts[i * 2] + pts[i * 2 + 2]) / 2, (pts[i * 2 + 1] + pts[i * 2 + 3]) / 2)
    lineTo(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1])
}

/** `answered`: Claude has answered the mark; it fades to grey so open marks stand out. */
fun DrawScope.strokes(list: List<Stroke>, p: Palette, answered: Boolean = false) {
    for (s in list.sortedBy { if (it.tool == "highlighter") 0 else 1 }) {
        val c = if (answered) p.ink3.copy(alpha = .6f) else cssColor(s.color, p)
        drawPath(strokePath(s.points), if (s.tool == "highlighter") c.copy(alpha = c.alpha * 0.4f) else c,
            style = Line(width = s.width, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

/** Where a mark starts: its pin goes there. */
private fun firstPoint(m: Mark): Offset = m.strokes.firstOrNull { it.points.size >= 2 }?.let { Offset(it.points[0], it.points[1]) } ?: Offset.Zero

/** Text sized in content units, so it scales with the board like everything else on it. */
fun DrawScope.text(tm: TextMeasurer, s: String, at: Offset, size: Float, color: Color, bold: Boolean = false, width: Float = 400f, lines: Int = 2, mono: Boolean = false) {
    if (s.isEmpty()) return
    drawText(tm, s, at, TextStyle(fontSize = (size / density).sp, color = color, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
        lineHeight = (size * 1.3f / density).sp, fontFamily = if (mono) androidx.compose.ui.text.font.FontFamily.Monospace else null),
        maxLines = lines, size = Size(width, size * 1.35f * lines), overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
}

/** Numbered pins where each mark starts; answered ones green with a check. */
fun DrawScope.pins(marks: List<Mark>, p: Palette, tm: TextMeasurer, k: Float) {
    val r = 12f / k * density
    marks.forEachIndexed { i, m ->
        val at = firstPoint(m)
        val done = m.state == "addressed"
        drawCircle(p.canvas, r + 2f / k * density, at)
        drawCircle(if (done) p.green else p.red, r, at)
        if (done) drawPath(Path().apply { moveTo(at.x - r * .45f, at.y); lineTo(at.x - r * .1f, at.y + r * .38f); lineTo(at.x + r * .48f, at.y - r * .35f) }, Color.White, style = Line(width = 2f / k * density, cap = StrokeCap.Round))
        else text(tm, "${i + 1}", Offset(at.x - r * .35f, at.y - r * .62f), r * 1.05f, Color.White, bold = true, width = r * 2)
    }
}

/**
 * Where a view looks: each view keeps its own. Until the person moves it, it fits the content into the room the
 * floating chrome leaves (`pad`, in px: rail, top bar, inspector, zoom capsule).
 */
class Camera {
    var xf by mutableStateOf(ViewXf())
    var moved by mutableStateOf(false)
    var size = Size.Zero
    var content = Size.Zero
    var pad = Rect.Zero
    var density = 1f

    private fun room() = Rect(pad.left, pad.top, size.width - pad.right, size.height - pad.bottom)

    fun fitted(): ViewXf {
        val r = room()
        if (r.width <= 0 || content.width <= 0) return xf
        val k = min(min(r.width / content.width, r.height / content.height) * 0.94f, 1.6f * density)
        return ViewXf(Offset(r.left + (r.width - content.width * k) / 2, r.top + max(0f, (r.height - content.height * k) / 2)), k)
    }

    /** Zooms by `by` around the middle of the room. */
    fun zoomed(by: Float): ViewXf {
        val c = room().center
        val k = (xf.k * by).coerceIn(0.2f * density, 5f * density)
        val anchor = xf.toContent(c)
        return ViewXf(Offset(c.x - anchor.x * k, c.y - anchor.y * k), k)
    }

    /** Keeps the zoom, centres `r` (content units) in the room. */
    fun showing(r: Rect): ViewXf {
        val c = room().center
        return ViewXf(Offset(c.x - r.center.x * xf.k, c.y - r.center.y * xf.k), xf.k)
    }

    /** Fits `r` (content units) in the room: one page on the canvas, close enough to write on. */
    fun framing(r: Rect): ViewXf {
        val room = room()
        val k = min(room.width / r.width, room.height / r.height) * 0.94f
        return ViewXf(Offset(room.center.x - r.center.x * k, room.center.y - r.center.y * k), k)
    }

    /** Glides to `to` on the camera spring; jumps when the tablet's animations are off. */
    suspend fun go(to: ViewXf, still: Boolean) {
        val from = xf
        if (still) { xf = to; return }
        animate(0f, 1f, animationSpec = spring(dampingRatio = 1f, stiffness = 200f)) { t, _ ->
            xf = ViewXf(from.off + (to.off - from.off) * t, from.k + (to.k - from.k) * t)
        }
    }
}

/** Animations off in the tablet's settings (Remove animations): the app moves without them. */
fun stillMotion(context: android.content.Context): Boolean =
    android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f

fun markBounds(m: Mark): Rect {
    var l = Float.MAX_VALUE; var t = Float.MAX_VALUE; var r = -Float.MAX_VALUE; var b = -Float.MAX_VALUE
    for (s in m.strokes) for (i in 0 until s.points.size / 2) { l = min(l, s.points[i * 2]); r = max(r, s.points[i * 2]); t = min(t, s.points[i * 2 + 1]); b = max(b, s.points[i * 2 + 1]) }
    return if (l == Float.MAX_VALUE) Rect.Zero else Rect(l, t, r, b)
}

/**
 * A pannable, zoomable board to draw on with the S Pen. The pen draws right away; fingers move it (one pans and
 * flings, two pinch), a two-finger tap undoes and a three-finger tap redoes. Holding the pen's button erases; a click
 * of it while hovering goes back to the previous tool. What the pen drew is kept as one mark when it rests.
 */
@Composable
fun Board(
    session: Session,
    ink: InkState,
    cam: Camera,
    view: String,
    page: String?,
    contentSize: Size,
    marks: List<Mark>,
    layer: GraphicsLayer,
    under: (Offset) -> String?,
    onTap: (Offset) -> Unit = {},
    modifier: Modifier = Modifier,
    draw: DrawScope.(Palette, TextMeasurer) -> Unit,
) {
    val p = LocalPalette.current
    val tm = rememberTextMeasurer()
    val scope = rememberCoroutineScope()
    val haptics = LocalView.current
    val density = LocalDensity.current.density
    cam.density = density
    cam.content = contentSize
    if (!cam.moved && cam.size.width > 0) cam.xf = cam.fitted()
    val xf = cam.xf
    var line by remember { mutableStateOf<Stroke?>(null) }
    var lasso by remember { mutableStateOf<FloatArray?>(null) }
    var caught by remember(view, page) { mutableStateOf<List<String>>(emptyList()) }
    // Dragging what the lasso caught: where the pen took hold, and how far it has gone.
    var grab by remember { mutableStateOf<Offset?>(null) }
    var shift by remember { mutableStateOf(Offset.Zero) }
    var note by remember { mutableStateOf<Offset?>(null) }
    var noteText by remember { mutableStateOf("") }
    var hover by remember { mutableStateOf<Offset?>(null) }
    val settle = remember { arrayOfNulls<Job>(1) }
    // The pointer loop lives as long as the view; it reads these as they are now, not as they were when it started.
    val marksNow by rememberUpdatedState(marks)
    val underNow by rememberUpdatedState(under)
    val tapNow by rememberUpdatedState(onTap)
    val erasing = remember { mutableSetOf<String>() }

    fun save(list: List<Stroke>, body: String? = null, on: String? = null) {
        if (list.isEmpty()) return
        val first = list.first().points
        val at = on ?: underNow(Offset(first[0], first.getOrElse(1) { 0f }))
        scope.launch {
            val placed = ink.placeOn?.invoke(list)
            val id = session.ask { if (placed != null) it.mark(placed.view, placed.page, null, placed.strokes, body) else it.mark(view, page, at, list, body) } ?: return@launch
            ink.mine.add(id)
            session.call {}
        }
    }
    /**
     * Puts the caught marks `by` further on: each saved again there (on the canvas, on the page now under it), the old
     * one erased unless it's a copy. What's caught becomes the new marks, to move again.
     */
    fun relocate(ids: List<String>, by: Offset, copy: Boolean) {
        val moving = marksNow.filter { it.id in ids }
        scope.launch {
            val fresh = moving.mapNotNull { m ->
                val list = m.strokes.map { it.moved(by.x, by.y) }
                val body = m.said.takeUnless { it.startsWith("Drew ") }
                val placed = ink.placeOn?.invoke(list)
                val first = list.first().points
                session.ask { mac ->
                    val id = if (placed != null) mac.mark(placed.view, placed.page, null, placed.strokes, body) else mac.mark(view, page, underNow(Offset(first[0], first[1])), list, body)
                    if (!copy) mac.erase(m.id)
                    id
                }
            }
            ink.mine.addAll(fresh)
            caught = fresh
            session.call {}
        }
    }
    fun flush() {
        settle[0]?.cancel()
        if (ink.pending.isEmpty()) return
        val list = ink.pending.toList()
        ink.pending.clear()
        save(list)
    }
    fun eraseAt(c: Offset) {
        val reach = 12f * density / cam.xf.k
        val hit = marksNow.firstOrNull { m -> m.strokes.any { s -> (0 until s.points.size / 2).any { i -> hypot(s.points[i * 2] - c.x, s.points[i * 2 + 1] - c.y) < reach + s.width } } }
        if (hit != null && erasing.add(hit.id)) session.call { it.erase(hit.id) }
        ink.pending.removeAll { s -> (0 until s.points.size / 2).any { i -> hypot(s.points[i * 2] - c.x, s.points[i * 2 + 1] - c.y) < reach + s.width } }
    }

    Box(modifier.fillMaxSize()) {
        Canvas(
            Modifier.fillMaxSize()
                .onSizeChanged { cam.size = Size(it.width.toFloat(), it.height.toFloat()); if (!cam.moved) cam.xf = cam.fitted() }
                .drawWithContent {
                    layer.record { this@drawWithContent.drawContent() }
                    drawLayer(layer)
                    // The pen's hover dot: drawn after the layer, so the picture sent to the Mac leaves it out.
                    hover?.let { at ->
                        val r = when (ink.tool) { Tool.Highlighter -> 8f * density; Tool.Eraser -> 12f * density; else -> 2.5f * density }
                        when (ink.tool) {
                            Tool.Eraser, Tool.Lasso -> drawCircle(p.ink3, r, at, style = Line(1.2f * density))
                            Tool.Highlighter -> drawCircle(cssColor(HIGHLIGHT, p).copy(alpha = .5f), r, at)
                            else -> drawCircle(cssColor(ink.color, p), r, at)
                        }
                    }
                }
                .pointerInput(view, page) {
                    val touches = HashMap<Long, Offset>()
                    var gesture: Triple<Offset, Float, ViewXf>? = null
                    // A finger gesture from first touch to last lift: how many fingers, when, and how far it went.
                    var most = 0
                    var since = 0L
                    var travel = 0f
                    var velocity = VelocityTracker()
                    var fling: Job? = null
                    var penDown = false
                    var button = false
                    awaitPointerEventScope {
                        while (true) {
                            val ev = awaitPointerEvent()
                            val pen = ev.changes.firstOrNull { it.type == PointerType.Stylus || it.type == PointerType.Eraser || it.type == PointerType.Mouse || session.fingersDraw }
                            if (pen != null) {
                                val x = cam.xf
                                val c = x.toContent(pen.position)
                                val pressedButton = ev.buttons.isSecondaryPressed
                                if (!pen.pressed) {
                                    // Hovering: a dot shows where the pen will land; a click of its button swaps back.
                                    hover = if (ev.type == PointerEventType.Exit) null else pen.position
                                    if (pressedButton && !button && !penDown) { ink.swap(); haptics.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) }
                                }
                                button = pressedButton
                                if (session.offline) { pen.consume(); continue }
                                val rubbing = pen.type == PointerType.Eraser || pressedButton || ink.tool == Tool.Eraser
                                when {
                                    pen.pressed && !penDown -> {
                                        penDown = true
                                        hover = null
                                        settle[0]?.cancel()
                                        when {
                                            rubbing -> eraseAt(c)
                                            ink.tool == Tool.Note -> { flush(); note = c; noteText = "" }
                                            // On what the lasso caught, the pen takes hold of it; elsewhere it starts a new loop.
                                            ink.tool == Tool.Lasso && caught.isNotEmpty() && marksNow.filter { it.id in caught }.any { m -> markBounds(m).inflate(16f * density / x.k).contains(c) } -> { grab = c; shift = Offset.Zero }
                                            ink.tool == Tool.Lasso -> { caught = emptyList(); lasso = floatArrayOf(c.x, c.y) }
                                            else -> line = Stroke(if (ink.tool == Tool.Highlighter) "highlighter" else "pen", if (ink.tool == Tool.Highlighter) HIGHLIGHT else ink.color,
                                                (if (ink.tool == Tool.Highlighter) 16f else 2.6f) * density / x.k, floatArrayOf(c.x, c.y))
                                        }
                                    }
                                    pen.pressed -> {
                                        val pts = (pen.historical.map { it.position } + pen.position).map { x.toContent(it) }
                                        when {
                                            rubbing -> pts.forEach { eraseAt(it) }
                                            grab != null -> shift = pts.last() - grab!!
                                            lasso != null -> lasso = lasso!! + pts.flatMap { listOf(it.x, it.y) }.toFloatArray()
                                            line != null -> line = line!!.copy(points = line!!.points + pts.flatMap { listOf(it.x, it.y) }.toFloatArray())
                                        }
                                    }
                                    penDown -> {
                                        penDown = false
                                        erasing.clear()
                                        if (grab != null) {
                                            grab = null
                                            val by = shift
                                            shift = Offset.Zero
                                            if (by.getDistance() > 4f * density / x.k) { relocate(caught, by, copy = false); haptics.performHapticFeedback(HapticFeedbackConstants.CONFIRM) }
                                        }
                                        val loop = lasso
                                        lasso = null
                                        if (loop != null) caught = marksNow.filter { m -> val pts = m.strokes.flatMap { s -> (0 until s.points.size / 2).map { Offset(s.points[it * 2], s.points[it * 2 + 1]) } }; pts.count { inLoop(loop, it) } > pts.size / 4 }.map { it.id }
                                        val done = line
                                        line = null
                                        if (done != null) {
                                            ink.pending.add(done)
                                            ink.undone.clear()
                                            haptics.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                                            settle[0] = scope.launch { delay(SETTLE_MS); flush() }
                                        }
                                    }
                                }
                                pen.consume()
                                continue
                            }
                            // Fingers: never ink. One moves the board, two pinch it; quick taps of one, two or three fingers tap, undo, redo.
                            for (ch in ev.changes) {
                                if (ch.pressed && !ch.previousPressed) {
                                    if (touches.isEmpty()) { most = 0; since = ch.uptimeMillis; travel = 0f; velocity = VelocityTracker(); fling?.cancel() }
                                    touches[ch.id.value] = ch.position
                                    most = max(most, touches.size)
                                } else if (ch.pressed) {
                                    travel += (ch.position - ch.previousPosition).getDistance()
                                    touches[ch.id.value] = ch.position
                                } else touches.remove(ch.id.value)
                                if (touches.size == 1 && ch.pressed) velocity.addPosition(ch.uptimeMillis, ch.position)
                                if (!ch.pressed && ch.previousPressed && touches.isEmpty()) {
                                    val quick = ch.uptimeMillis - since < 300 && travel < 16 * density * most
                                    when {
                                        quick && most == 1 -> tapNow(cam.xf.toContent(ch.position))
                                        quick && most == 2 -> { undo(session, ink, marksNow); haptics.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) }
                                        quick && most == 3 -> { redo(session, ink, view, page); haptics.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) }
                                        most == 1 && !stillMotion(haptics.context) -> {
                                            val v = velocity.calculateVelocity()
                                            val speed = hypot(v.x, v.y)
                                            if (speed > 300f) fling = scope.launch {
                                                val start = cam.xf
                                                val dir = Offset(v.x / speed, v.y / speed)
                                                animateDecay(0f, speed, FloatExponentialDecaySpec(frictionMultiplier = 1.5f)) { d, _ -> cam.xf = start.copy(off = start.off + dir * d) }
                                            }
                                        }
                                    }
                                }
                                ch.consume()
                            }
                            val pts = touches.values.toList()
                            if (pts.isEmpty()) { gesture = null; continue }
                            val centre = Offset(pts.map { it.x }.average().toFloat(), pts.map { it.y }.average().toFloat())
                            val spread = if (pts.size > 1) (pts[0] - pts[1]).getDistance() else 0f
                            val g = gesture
                            if (g == null || (g.second == 0f) != (spread == 0f)) { gesture = Triple(centre, spread, cam.xf); continue }
                            val (c0, d0, x0) = g
                            if (travel < 16 * density * most) continue
                            val k = if (d0 > 0f && spread > 0f) (x0.k * spread / d0).coerceIn(0.2f * density, 5f * density) else x0.k
                            cam.moved = true
                            val anchor = x0.toContent(c0)
                            cam.xf = ViewXf(Offset(centre.x - anchor.x * k, centre.y - anchor.y * k), k)
                        }
                    }
                }
        ) {
            // A dotted plane that moves with the board, so moving it reads as moving over paper.
            val step = 22f * density
            val ox = ((xf.off.x % step) + step) % step
            val oy = ((xf.off.y % step) + step) % step
            var gy = oy
            while (gy < this.size.height) { var gx = ox; while (gx < this.size.width) { drawCircle(p.dot, 1.4f * density, Offset(gx, gy)); gx += step }; gy += step }
            withTransform({ translate(xf.off.x, xf.off.y); scale(xf.k, xf.k, Offset.Zero) }) {
                draw(p, tm)
                // What's being dragged is drawn where it's going.
                fun shown(m: Mark) = if (grab != null && m.id in caught) m.strokes.map { it.moved(shift.x, shift.y) } else m.strokes
                for (m in marks) strokes(shown(m), p, answered = m.state == "addressed")
                for (id in caught) marks.firstOrNull { it.id == id }?.let { m -> shown(m).forEach { s -> drawPath(strokePath(s.points), p.accent.copy(alpha = .35f), style = Line(width = 10f * density / xf.k, cap = StrokeCap.Round)) } }
                strokes(ink.pending.toList() + listOfNotNull(line), p)
                lasso?.let { drawPath(strokePath(it), p.accent, style = Line(width = 2f * density / xf.k, pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(8f, 6f)))) }
                pins(marks, p, tm, xf.k)
            }
        }
        // Words with a mark: typed with the keyboard where the note tool touched.
        note?.let { at ->
            val focus = remember { FocusRequester() }
            LaunchedEffect(at) { focus.requestFocus() }
            val sx = (at.x * xf.k + xf.off.x).roundToInt()
            val sy = (at.y * xf.k + xf.off.y).roundToInt()
            Column(Modifier.offset { IntOffset(sx, sy + (12 * density).roundToInt()) }.width(300.dp).background(p.surface, RoundedCornerShape(14.dp)).border(1.dp, p.line, RoundedCornerShape(14.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                BasicTextField(noteText, { noteText = it }, Modifier.width(276.dp).height(80.dp).background(p.canvas, RoundedCornerShape(8.dp)).padding(10.dp).focusRequester(focus),
                    textStyle = TextStyle(color = p.ink, fontSize = 17.sp), cursorBrush = androidx.compose.ui.graphics.SolidColor(p.accent))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.align(Alignment.End)) {
                    Pill("Cancel", p.fill, p.ink) { note = null }
                    Pill("Keep note", p.accent, Color.White) {
                        val words = noteText.trim()
                        note = null
                        if (words.isNotEmpty()) {
                            val ring = FloatArray(26) { i -> val a = (i / 2) / 12.0 * 2 * Math.PI; if (i % 2 == 0) at.x + 6f * kotlin.math.cos(a).toFloat() else at.y + 6f * kotlin.math.sin(a).toFloat() }
                            save(listOf(Stroke("pen", ink.color, 2.6f, ring)), words)
                        }
                    }
                }
            }
        }
        if (caught.isNotEmpty()) {
            Row(Modifier.align(Alignment.TopCenter).padding(top = 80.dp).background(p.chrome, RoundedCornerShape(14.dp)).border(1.dp, p.line, RoundedCornerShape(14.dp)).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Pill("Done", p.fill, p.ink) { caught = emptyList() }
                // A copy a little down and right, caught, to drag where it goes.
                Pill("Copy", p.fill, p.ink) { relocate(caught, Offset(24f, 24f) * (density / xf.k), copy = true) }
                Pill("Erase ${caught.size} mark${if (caught.size == 1) "" else "s"}", p.destructive, Color.White) { val ids = caught; caught = emptyList(); ids.forEach { id -> session.call { it.erase(id) } } }
            }
        }
    }
}


private fun inLoop(loop: FloatArray, p: Offset): Boolean {
    var hit = false
    var j = loop.size - 2
    var i = 0
    while (i < loop.size - 1) {
        val xi = loop[i]; val yi = loop[i + 1]; val xj = loop[j]; val yj = loop[j + 1]
        if ((yi > p.y) != (yj > p.y) && p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) hit = !hit
        j = i; i += 2
    }
    return hit
}

/** Undo: drops the last line still waiting, else takes this tablet's last mark back from the Mac. */
fun undo(session: Session, ink: InkState, marks: List<Mark>) {
    if (ink.pending.isNotEmpty()) { ink.pending.removeAt(ink.pending.lastIndex); return }
    // Marks deleted since (from the panel, the eraser or the Mac) are already gone: skip them.
    val m = generateSequence { ink.mine.removeLastOrNull() }.firstNotNullOfOrNull { id -> marks.firstOrNull { it.id == id } } ?: return
    ink.undone.add(Triple(m.strokes, m.said.takeUnless { it.startsWith("Drew ") }, m.on))
    session.call { it.erase(m.id) }
}

fun redo(session: Session, ink: InkState, view: String, page: String?) {
    val (strokes, body, on) = ink.undone.removeLastOrNull() ?: return
    val placed = ink.placeOn?.invoke(strokes)
    session.call { mac -> ink.mine.add(if (placed != null) mac.mark(placed.view, placed.page, null, placed.strokes, body) else mac.mark(view, page, on, strokes, body)) }
}

/** What the board shows, as a PNG in base64, at most 1600 px wide: the picture the agent reads the handwriting from. */
suspend fun picture(layer: GraphicsLayer): String? = runCatching {
    var bmp: Bitmap = layer.toImageBitmap().asAndroidBitmap()
    if (bmp.width > 1600) bmp = Bitmap.createScaledBitmap(bmp, 1600, (bmp.height * 1600f / bmp.width).roundToInt(), true)
    val out = ByteArrayOutputStream()
    bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
    Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}.getOrNull()

@Composable
fun Pill(label: String, bg: Color, fg: Color, onClick: () -> Unit) {
    Box(Modifier.height(48.dp).background(bg, RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
        androidx.compose.foundation.text.BasicText(label, style = TextStyle(color = fg, fontSize = 15.sp, fontWeight = FontWeight.SemiBold))
    }
}
