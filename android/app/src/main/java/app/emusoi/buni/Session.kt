package app.emusoi.buni

import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class View { Home, Context, System, Api, Screens, Flows }

/** The one trailing inspector panel open over a view. */
enum class Panel { Marks, Plan, Drafting, Operation, Step, Walk }

/**
 * The connection to the Mac and what it last said: the design, whether the cable is up, and where the person is.
 * It keeps trying while the Mac is away (the waiting screen shows), and redraws on every change the Mac reports.
 */
class Session(private val context: Context, private val scope: CoroutineScope) {
    private val prefs = context.getSharedPreferences("buni", Context.MODE_PRIVATE)
    /** The last design the Mac sent; kept (read-only) while the cable is out. */
    var design by mutableStateOf<Design?>(null)
        private set
    /** Why the Mac isn't there, when it isn't; null while connected. With a design, the app shows it offline. */
    var waiting by mutableStateOf<String?>("Waiting for buni on the Mac")
        private set
    val offline get() = waiting != null
    /** Where the person is; remembered, so the app opens where they left it. */
    var view by mutableStateOf(runCatching { View.valueOf(prefs.getString("view", null) ?: "") }.getOrDefault(View.Home))
        private set
    var toast by mutableStateOf<Toast?>(null)
        private set
    /** Marks sent for a plan that hasn't arrived yet. */
    var drafting by mutableStateOf<Drafting?>(null)
    /** The Screens canvas, asked for again when the design changes: the Mac draws every page for it first. */
    var canvas by mutableStateOf<CanvasData?>(null)
        private set
    private var canvasJob: Job? = null
    var panel by mutableStateOf<Panel?>(null)
    var leftHanded by mutableStateOf(prefs.getBoolean("leftHanded", false))
        private set
    /** First-time tips already dismissed. */
    var tipsSeen by mutableStateOf(prefs.getStringSet("tips", emptySet())!!.toSet())
        private set
    val pages = mutableStateMapOf<String, Bitmap>()
    /** Debug fixture only (fake://fingers): a finger draws like the pen, so injected touches can test the ink. */
    var fingersDraw = false
        private set

    private var mac: Mac? = null
    private var loop: Job? = null
    private var toastJob: Job? = null

    init {
        val base = prefs.getString("base", null)
        val token = prefs.getString("token", null)
        val file = prefs.getString("file", null)
        if (base != null && token != null && file != null) start(CableMac(base, token, file))
    }

    fun go(v: View) { view = v; prefs.edit().putString("view", v.name).apply() }
    fun leftHand(on: Boolean) { leftHanded = on; prefs.edit().putBoolean("leftHanded", on).apply() }
    fun tipSeen(id: String) { tipsSeen = tipsSeen + id; prefs.edit().putStringSet("tips", tipsSeen).apply() }
    fun showTipsAgain() { tipsSeen = emptySet(); prefs.edit().remove("tips").apply() }

    /** Forgets the Mac: the token goes, and the app waits to be opened from the Mac again. */
    fun disconnect() {
        loop?.cancel()
        mac = null
        prefs.edit().remove("base").remove("token").remove("file").apply()
        design = null
        canvas = null
        drafting = null
        panel = null
        pages.clear()
        waiting = "Waiting for buni on the Mac"
    }

    /** The Mac opened the app: http://localhost:<port>/tablet/v1?code=…; only localhost is ever accepted. */
    fun opened(url: String?) {
        if (url == null) return
        if (url.startsWith("fake://") && (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            fingersDraw = url == "fake://fingers"
            start(FakeMac(context))
            return
        }
        val u = Uri.parse(url)
        val code = u.getQueryParameter("code") ?: return
        if (u.scheme != "http" || (u.host != "localhost" && u.host != "127.0.0.1") || u.port <= 0) return
        val base = "http://${u.host}:${u.port}"
        scope.launch {
            try {
                val (token, file) = withContext(Dispatchers.IO) { CableMac.pair(base, code) }
                prefs.edit().putString("base", base).putString("token", token).putString("file", file).apply()
                if (file != design?.file) { design = null; go(View.Home) }
                pages.clear()
                start(CableMac(base, token, file))
            } catch (e: Exception) {
                waiting = e.message ?: "The Mac didn't answer."
            }
        }
    }

    private fun start(m: Mac) {
        mac = m
        loop?.cancel()
        loop = scope.launch {
            while (isActive) {
                try {
                    refresh()
                    withContext(Dispatchers.IO) { m.events { scope.launch { runCatching { refresh() } } } }
                } catch (e: CancellationException) {
                    // A newer Mac took over (opened again): this loop's failure isn't the app's state any more.
                    throw e
                } catch (e: MacError) {
                    waiting = if (e.status == 401) "Open the design from the Mac again: choose Open on tablet there." else e.message
                } catch (e: Exception) {
                    waiting = "Waiting for buni on the Mac"
                }
                delay(3_000)
            }
        }
    }

    private suspend fun refresh() {
        val m = mac ?: return
        val d = withContext(Dispatchers.IO) { m.design() }
        if (design?.version != d.version || design?.file != d.file) {
            // A plan arrived for the marks that were sent: drafting is over.
            if (drafting != null && d.plans.any { p -> design?.plans?.none { it.id == p.id } != false }) { drafting = null; if (panel == Panel.Drafting) panel = Panel.Plan }
            if (design?.file != d.file) canvas = null
            design = d
            canvasJob?.cancel()
            canvasJob = scope.launch { runCatching { withContext(Dispatchers.IO) { m.canvas() } }.getOrNull()?.let { canvas = it } }
        }
        waiting = null
    }

    /** Runs a call to the Mac off the main thread; a failure becomes a toast in the person's words. */
    fun call(after: (() -> Unit)? = null, block: (Mac) -> Unit) {
        val m = mac ?: return
        scope.launch {
            try {
                withContext(Dispatchers.IO) { block(m) }
                refresh()
                after?.invoke()
            } catch (e: Exception) {
                say(e.message ?: "The Mac didn't answer.")
            }
        }
    }

    suspend fun <T> ask(block: (Mac) -> T): T? {
        val m = mac ?: return null
        return try { withContext(Dispatchers.IO) { block(m) } } catch (e: Exception) { say(e.message ?: "The Mac didn't answer."); null }
    }

    /** The design version each page was last asked for at: a change on the Mac asks again (an unchanged page answers 304). */
    private val pageAt = mutableMapOf<String, Long>()

    fun page(id: String) {
        val v = design?.version ?: 0L
        if (pageAt[id] == v && pages.containsKey(id)) return
        pageAt[id] = v
        scope.launch { ask { it.page(id) }?.let { pages[id] = it } }
    }

    /** One toast at a time, for 8 seconds; `undo` adds an Undo button. */
    fun say(text: String, undo: (() -> Unit)? = null) {
        val t = Toast(text, undo)
        toast = t
        toastJob?.cancel()
        toastJob = scope.launch { delay(8_000); if (toast === t) toast = null }
    }

    fun dismissToast() { toast = null }
}

class Toast(val text: String, val undo: (() -> Unit)?)

/** Marks sent to the Mac for a plan: `copied` when the request is on the Mac's clipboard for Claude Code. */
data class Drafting(val view: String, val count: Int, val copied: Boolean)
