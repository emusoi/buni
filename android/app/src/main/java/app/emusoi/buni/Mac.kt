package app.emusoi.buni

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/** A call the Mac turned down, with its words for the person; 401 means the tablet has to be opened from the Mac again. */
class MacError(val status: Int, message: String) : IOException(message)

data class Sent(val count: Int, val copied: Boolean)

/** buni open on the Mac, as the tablet sees it (docs/tablet-api.md). Every call blocks: run them off the main thread. */
interface Mac {
    fun design(): Design
    /** The Screens canvas; slow the first time, while the Mac draws every page. */
    fun canvas(): CanvasData?
    fun page(id: String): Bitmap?
    fun mark(view: String, page: String?, on: String?, strokes: List<Stroke>, body: String?): String
    fun erase(id: String)
    fun send(view: String, page: String?, picture: String?): Sent
    /** Merges or discards a plan; `skip`: changes the person unticked, left out of a merge. */
    fun plan(id: String, action: String, skip: List<String> = emptyList()): String
    /** Blocks while the feed is open, calling `changed` on each change; returns when it closes. */
    fun events(changed: () -> Unit)
}

/** Over the cable: the base is the Mac's localhost address the tablet was opened with, and nothing else. */
class CableMac(private val base: String, private val token: String, private val file: String) : Mac {
    /** The last drawing of each page, by its ETag: asked again with If-None-Match, an unchanged page costs nothing. */
    private val drawn = mutableMapOf<String, String>()

    private fun open(path: String, method: String = "GET", body: JSONObject? = null, timeout: Int = 15_000): HttpURLConnection {
        val sep = if (path.contains('?')) '&' else '?'
        val c = URL("$base$path${sep}file=${java.net.URLEncoder.encode(file, "UTF-8")}").openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 5_000
        c.readTimeout = timeout
        c.setRequestProperty("Authorization", "Bearer $token")
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        return c
    }

    private fun json(c: HttpURLConnection): JSONObject {
        val ok = c.responseCode in 200..299
        val text = (if (ok) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        if (!ok) throw MacError(c.responseCode, runCatching { JSONObject(text).optString("error") }.getOrNull()?.ifBlank { null } ?: "The Mac said ${c.responseCode}.")
        return JSONObject(text)
    }

    override fun design() = parseDesign(json(open("/tablet/v1/design")))
    override fun canvas() = parseCanvas(json(open("/tablet/v1/canvas", timeout = 180_000)))

    override fun page(id: String): Bitmap? {
        val c = open("/tablet/v1/page.png?page=${java.net.URLEncoder.encode(id, "UTF-8")}", timeout = 60_000).apply {
            drawn[id]?.let { setRequestProperty("If-None-Match", it) }
        }
        // 304: the page hasn't changed since it was drawn; the one on screen stays.
        if (c.responseCode != 200) return null
        c.getHeaderField("ETag")?.let { drawn[id] = it }
        return c.inputStream.use { BitmapFactory.decodeStream(it) }
    }

    override fun mark(view: String, page: String?, on: String?, strokes: List<Stroke>, body: String?): String {
        val o = JSONObject().put("view", view).put(if (view == "flow") "flow" else "page", page ?: JSONObject.NULL).put("on", on ?: JSONObject.NULL)
            .put("strokes", JSONArray().also { a -> strokes.forEach { a.put(strokeJson(it)) } })
        if (body != null) o.put("body", body)
        return json(open("/tablet/v1/marks", "POST", o)).optString("id")
    }

    override fun erase(id: String) { json(open("/tablet/v1/marks/erase", "POST", JSONObject().put("id", id))) }

    override fun send(view: String, page: String?, picture: String?): Sent {
        val o = JSONObject().put("view", view)
        if (page != null) o.put(if (view == "flow") "flow" else "page", page)
        if (picture != null) o.put("picture", picture)
        val r = json(open("/tablet/v1/send", "POST", o, 60_000))
        return Sent(r.optInt("count"), r.optBoolean("copied"))
    }

    override fun plan(id: String, action: String, skip: List<String>): String =
        json(open("/tablet/v1/plan", "POST", JSONObject().put("plan", id).put("action", action).put("skip", JSONArray(skip)))).optString("reply")

    override fun events(changed: () -> Unit) {
        val c = open("/tablet/v1/events", timeout = 45_000)
        if (c.responseCode != 200) throw MacError(c.responseCode, "The Mac's feed said ${c.responseCode}.")
        BufferedReader(InputStreamReader(c.inputStream)).use { r ->
            while (true) {
                val line = r.readLine() ?: return
                if (line.startsWith("data:")) changed()
            }
        }
    }

    companion object {
        /** Trades the Mac's one-time code for a token: (token, file). */
        fun pair(base: String, code: String): Pair<String, String> {
            val c = URL("$base/tablet/v1/pair").openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.connectTimeout = 5_000
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(JSONObject().put("code", code).toString().toByteArray()) }
            val ok = c.responseCode in 200..299
            val text = (if (ok) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
            val o = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
            if (!ok) throw MacError(c.responseCode, o.optString("error").ifBlank { "The Mac turned the code down." })
            return o.optString("token") to o.optString("file")
        }
    }
}

/** Debug builds only: the designs' Parcel returns system from a bundled fixture, for working on the app without a Mac. */
class FakeMac(context: Context) : Mac {
    private var current: Design = parseDesign(JSONObject(context.assets.open("fake.json").bufferedReader().use { it.readText() }))
    private var next = 100

    override fun design() = current
    override fun canvas(): CanvasData? = null
    override fun page(id: String): Bitmap? = null
    override fun mark(view: String, page: String?, on: String?, strokes: List<Stroke>, body: String?): String {
        val id = "fake${next++}"
        current = current.copy(version = current.version + 1, marks = current.marks + Mark(id, view, page, on, null, "Drawing", body ?: "Drew a mark.", "this tablet", "open", strokes))
        return id
    }
    override fun erase(id: String) { current = current.copy(version = current.version + 1, marks = current.marks.filterNot { it.id == id }) }
    override fun send(view: String, page: String?, picture: String?) = Sent(current.marksOn(view, page).size, true)
    override fun plan(id: String, action: String, skip: List<String>): String {
        val p = current.plans.firstOrNull { it.id == id } ?: throw MacError(404, "That plan is gone.")
        // A merge makes what it kept live; a discard drops what it proposed.
        val kept = if (action == "merge") p.changes.map { it.id }.filterNot { it in skip }.toSet() else emptySet()
        val dropped = p.changes.map { it.id }.toSet() - kept
        fun level(m: MapData?) = m?.copy(
            boxes = m.boxes.filterNot { b -> b.tone == "planned" && b.ids.any { it in dropped } }.map { b -> if (b.ids.any { it in kept }) b.copy(tone = "live") else b },
            links = m.links.filterNot { l -> l.tone == "planned" && l.ids.any { it in dropped } }.map { l -> if (l.ids.any { it in kept }) l.copy(tone = "live") else l },
        )
        current = current.copy(version = current.version + 1, context = level(current.context), system = level(current.system), plans = current.plans.filterNot { it.id == id })
        return "Done."
    }
    override fun events(changed: () -> Unit) { Thread.sleep(60_000) }
}
