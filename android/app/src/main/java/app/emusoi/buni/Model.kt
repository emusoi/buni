package app.emusoi.buni

import androidx.compose.ui.geometry.Offset
import org.json.JSONArray
import org.json.JSONObject

// What the Mac sends (docs/tablet-api.md), read once from JSON into plain values the screens draw.

data class Box(val key: String, val ids: List<String>, val x: Float, val y: Float, val w: Float, val h: Float,
               val label: String, val name: String, val sub: String?, val tone: String)
data class Frame(val key: String, val x: Float, val y: Float, val w: Float, val h: Float, val title: String)
data class Link(val key: String, val ids: List<String>, val from: String, val to: String, val label: String?,
                val tone: String, val points: List<Offset>, val at: Offset?)
data class MapData(val width: Float, val height: Float, val boxes: List<Box>, val frames: List<Frame>, val links: List<Link>)

data class ApiRow(val op: String, val y: Float, val h: Float, val method: String?, val path: String?, val field: String?,
                  val returns: String?, val note: String?, val about: String?, val request: String?, val responses: List<String>)
data class ApiCard(val part: String, val name: String, val kind: String, val spec: String?, val x: Float, val y: Float,
                   val w: Float, val h: Float, val sections: List<Pair<String, Float>>, val rows: List<ApiRow>)
data class Caller(val id: String, val name: String, val label: String?, val sub: String?, val x: Float, val y: Float,
                  val w: Float, val h: Float, val to: List<String>)
data class ApiData(val width: Float, val height: Float, val callers: List<Caller>, val cards: List<ApiCard>, val resolves: List<Pair<String, String>>)

/** A flow as the Mac lays it out: the usual path's steps in a row, the screens a condition reaches under them. */
data class FlowScreen(val page: String, val name: String, val x: Float, val y: Float, val w: Float, val h: Float, val step: Int?,
                      val whenIt: String?, val back: String?, val card: androidx.compose.ui.geometry.Rect?)
/** A way on from a screen: what's tapped, and the condition when it isn't the usual way. */
data class FlowMove(val from: String, val to: String, val label: String, val whenIt: String?)
data class FlowLink(val from: String, val to: String, val label: String, val condition: Boolean, val points: List<Offset>, val at: Offset?)
data class JourneyStep(val page: String, val confidence: Int?, val cells: Map<String, String>)
data class Flow(val id: String, val name: String, val width: Float, val height: Float, val screens: List<FlowScreen>, val links: List<FlowLink>,
                val moves: List<FlowMove>, val lanes: List<String>, val journey: List<JourneyStep>)

/** A pen line: x, y pairs in the view's own units (map units, the page's pixels, or the flow's). */
data class Stroke(val tool: String, val color: String, val width: Float, val points: FloatArray) {
    fun moved(dx: Float, dy: Float) = copy(points = FloatArray(points.size) { points[it] + if (it % 2 == 0) dx else dy })
}
/**
 * On a flow, `page` holds the flow's id: what the mark is on, as it does for a page. On the Screens canvas a page's
 * marks are moved to where the page sits; `at` is how far, so they can go back to the page's own pixels.
 */
data class Mark(val id: String, val view: String, val page: String?, val on: String?, val onName: String?, val kind: String,
                val said: String, val from: String?, val state: String, val strokes: List<Stroke>, val at: Offset = Offset.Zero, val screen: String? = null)

/** The Screens canvas as the editor lays it out (docs/tablet-api.md): pages in rows, row titles, links. */
data class CanvasBoard(val page: String, val name: String, val x: Float, val y: Float, val w: Float, val h: Float)
data class RowTitle(val x: Float, val y: Float, val name: String, val pages: Int)
/** `path`: the link's line, as SVG commands (M, V, H, Q) and their numbers. */
data class CanvasLink(val id: String, val from: String, val to: String, val label: String, val path: List<Pair<Char, FloatArray>>, val dot: Offset?, val at: Offset?)
/** `origin`: where the editor's canvas 0, 0 is here; a sketch's points are the editor's, so it's drawn moved by this. */
data class CanvasData(val width: Float, val height: Float, val origin: Offset, val boards: List<CanvasBoard>, val titles: List<RowTitle>, val links: List<CanvasLink>) {
    fun boardAt(p: Offset): CanvasBoard? = boards.lastOrNull { p.x in it.x..(it.x + it.w) && p.y in it.y..(it.y + it.h) }
}

/** SVG path data with absolute M, V, H and Q only: what the Mac's link routing writes. */
fun parsePath(d: String): List<Pair<Char, FloatArray>> {
    val out = mutableListOf<Pair<Char, FloatArray>>()
    val tokens = d.trim().split(Regex("[\\s,]+")).filter { it.isNotEmpty() }
    var i = 0
    while (i < tokens.size) {
        val c = tokens[i++].firstOrNull() ?: break
        val n = when (c) { 'M', 'L' -> 2; 'V', 'H' -> 1; 'Q' -> 4; else -> return out }
        if (i + n > tokens.size) break
        out += c to FloatArray(n) { tokens[i + it].toFloatOrNull() ?: 0f }
        i += n
    }
    return out
}

fun parseCanvas(o: JSONObject): CanvasData = CanvasData(
    o.f("width"), o.f("height"), o.optJSONArray("origin").point() ?: Offset.Zero,
    o.optJSONArray("boards").objs().map { CanvasBoard(it.optString("page"), it.optString("name"), it.f("x"), it.f("y"), it.f("w"), it.f("h")) },
    o.optJSONArray("titles").objs().map { RowTitle(it.f("x"), it.f("y"), it.optString("name"), it.optInt("pages")) },
    o.optJSONArray("links").objs().map { CanvasLink(it.optString("id"), it.optString("from"), it.optString("to"), it.optString("label"), parsePath(it.optString("d")), it.optJSONArray("dot").point(), it.optJSONArray("at").point()) },
)
data class PlanChange(val id: String, val change: String, val title: String, val detail: String?)
data class Plan(val id: String, val name: String, val issue: String?, val about: String?, val changes: List<PlanChange>)
data class PageInfo(val id: String, val name: String, val route: String?, val width: Float, val marks: Int)

data class Design(val file: String, val name: String, val version: Long, val context: MapData?, val system: MapData?,
                  val api: ApiData?, val pages: List<PageInfo>, val marks: List<Mark>, val plans: List<Plan>, val flows: List<Flow> = emptyList()) {
    /** `page`: the page or the flow, on those views. */
    fun marksOn(view: String, page: String? = null): List<Mark> =
        marks.filter { it.view == view && (view != "page" && view != "flow" || it.page == page) && it.state != "resolved" }
}

private fun JSONObject.str(k: String): String? = if (has(k) && !isNull(k)) optString(k) else null
private fun JSONObject.f(k: String): Float = optDouble(k, 0.0).toFloat()
private fun JSONArray?.objs(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).map { getJSONObject(it) }
private fun JSONArray?.strs(): List<String> = if (this == null) emptyList() else (0 until length()).map { getString(it) }
private fun JSONArray?.point(): Offset? = if (this == null || length() < 2) null else Offset(getDouble(0).toFloat(), getDouble(1).toFloat())

fun parseMap(o: JSONObject?): MapData? = o?.let { m ->
    MapData(
        m.f("width"), m.f("height"),
        m.optJSONArray("boxes").objs().map { Box(it.optString("key"), it.optJSONArray("ids").strs(), it.f("x"), it.f("y"), it.f("w"), it.f("h"),
            it.optString("label"), it.optString("name"), it.str("sub"), it.optString("tone", "live")) },
        m.optJSONArray("frames").objs().map { Frame(it.optString("key"), it.f("x"), it.f("y"), it.f("w"), it.f("h"), it.optString("title")) },
        m.optJSONArray("links").objs().map { l ->
            Link(l.optString("key"), l.optJSONArray("ids").strs(), l.optString("from"), l.optString("to"), l.str("label"), l.optString("tone", "live"),
                l.optJSONArray("points").let { a -> if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONArray(it).point() } },
                l.optJSONArray("at").point())
        },
    )
}

fun parseApi(o: JSONObject?): ApiData? = o?.let { a ->
    ApiData(
        a.f("width"), a.f("height"),
        a.optJSONArray("callers").objs().map { Caller(it.optString("id"), it.optString("name"), it.str("label"), it.str("sub"), it.f("x"), it.f("y"), it.f("w"), it.f("h"), it.optJSONArray("to").strs()) },
        a.optJSONArray("cards").objs().map { c ->
            ApiCard(c.optString("part"), c.optString("name"), c.optString("kind"), c.str("spec"), c.f("x"), c.f("y"), c.f("w"), c.f("h"),
                c.optJSONArray("sections").objs().map { it.optString("label") to it.f("y") },
                c.optJSONArray("rows").objs().map { r -> ApiRow(r.optString("op"), r.f("y"), r.f("h"), r.str("method"), r.str("path"), r.str("field"),
                    r.str("returns"), r.str("note"), r.str("about"), r.str("request"), r.optJSONArray("responses").strs()) })
        },
        a.optJSONArray("resolves").objs().map { it.optString("from") to it.optString("to") },
    )
}

fun parseStroke(s: JSONObject): Stroke {
    val p = s.optJSONArray("points")
    return Stroke(s.optString("tool", "pen"), s.optString("color", "#c8331f"), s.f("width").takeIf { it > 0 } ?: 2.5f,
        FloatArray(p?.length() ?: 0) { p!!.getDouble(it).toFloat() })
}

fun strokeJson(s: Stroke): JSONObject = JSONObject().put("tool", s.tool).put("color", s.color).put("width", s.width.toDouble())
    .put("points", JSONArray().also { a -> s.points.forEach { a.put(Math.round(it * 10) / 10.0) } })

fun parseDesign(o: JSONObject): Design {
    val levels = o.optJSONObject("levels")
    return Design(
        o.optString("file"), o.optString("name"), o.optLong("version"),
        parseMap(levels?.optJSONObject("context")), parseMap(levels?.optJSONObject("system")), parseApi(o.optJSONObject("api")),
        o.optJSONArray("pages").objs().map { PageInfo(it.optString("id"), it.optString("name"), it.str("route"), it.f("width").takeIf { w -> w > 0 } ?: 390f, it.optInt("marks")) },
        o.optJSONArray("marks").objs().map { m ->
            Mark(m.optString("id"), m.optString("view"), m.str("page") ?: m.str("flow"), m.str("on"), m.str("onName"), m.optString("kind", "Drawing"),
                m.optString("said"), m.str("from"), m.optString("state", "open"), m.optJSONArray("strokes").objs().map(::parseStroke), screen = m.str("screen"))
        },
        o.optJSONArray("plans").objs().map { p ->
            Plan(p.optString("id"), p.optString("name"), p.str("issue"), p.str("about"),
                p.optJSONArray("changes").objs().map { PlanChange(it.optString("id"), it.optString("change"), it.optString("title"), it.str("detail")) })
        },
        o.optJSONArray("flows").objs().map { f ->
            Flow(f.optString("id"), f.optString("name"), f.f("width"), f.f("height"),
                f.optJSONArray("screens").objs().map { s ->
                    val c = s.optJSONArray("card")
                    FlowScreen(s.optString("page"), s.optString("name"), s.f("x"), s.f("y"), s.f("w"), s.f("h"), if (s.isNull("step")) null else s.optInt("step"),
                        s.str("when"), s.str("back"), if (c == null || c.length() < 4) null else androidx.compose.ui.geometry.Rect(c.getDouble(0).toFloat(), c.getDouble(1).toFloat(),
                            (c.getDouble(0) + c.getDouble(2)).toFloat(), (c.getDouble(1) + c.getDouble(3)).toFloat()))
                },
                f.optJSONArray("links").objs().map { l ->
                    FlowLink(l.optString("from"), l.optString("to"), l.optString("label"), l.optBoolean("when"),
                        l.optJSONArray("points").let { a -> if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONArray(it).point() } }, l.optJSONArray("at").point())
                },
                f.optJSONArray("moves").objs().map { FlowMove(it.optString("from"), it.optString("to"), it.optString("label"), it.str("when")) },
                f.optJSONArray("lanes").strs(),
                f.optJSONArray("journey").objs().map { j ->
                    val cells = j.optJSONObject("cells")
                    JourneyStep(j.optString("page"), if (j.isNull("confidence")) null else j.optInt("confidence"), cells?.keys()?.asSequence()?.associateWith { cells.optString(it) } ?: emptyMap())
                })
        },
    )
}
