package app.emusoi.buni

import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.provider.Settings
import android.view.HapticFeedbackConstants
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.hypot
import kotlin.math.roundToInt

// The type ramp (docs/hig-for-buni-tablet.md): each size's line height.
private fun lineFor(size: Float): Float = when {
    size >= 34f -> 41f; size >= 28f -> 34f; size >= 22f -> 28f; size >= 20f -> 25f; size >= 17f -> 22f
    size >= 16f -> 21f; size >= 15f -> 20f; size >= 13f -> 18f; size >= 12f -> 16f; else -> 13f
}

@Composable
fun T(s: String, size: TextUnit = 17.sp, color: Color = LocalPalette.current.ink, bold: Boolean = false, modifier: Modifier = Modifier, align: TextAlign? = null, lines: Int = Int.MAX_VALUE, mono: Boolean = false) {
    BasicText(s, modifier, style = TextStyle(color = color, fontSize = size, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
        lineHeight = lineFor(size.value).sp, textAlign = align ?: TextAlign.Unspecified, fontFamily = if (mono) FontFamily.Monospace else null),
        maxLines = lines, overflow = TextOverflow.Ellipsis)
}

/** Floating chrome: a shadow in light mode; in dark, a lighter surface with a hairline instead. */
@Composable
fun Modifier.floating(radius: Dp): Modifier {
    val p = LocalPalette.current
    val s = RoundedCornerShape(radius)
    val lifted = if (p.dark) this.border(1.dp, p.line, s) else this.shadow(10.dp, s, ambientColor = Color(0x29000000), spotColor = Color(0x29000000))
    return lifted.background(p.chrome, s).clip(s)
}

/** A control: one description for TalkBack and a button role. */
fun Modifier.button(label: String, enabled: Boolean = true, onClick: () -> Unit): Modifier =
    this.semantics(mergeDescendants = true) { contentDescription = label }.clickable(enabled = enabled, role = Role.Button, onClick = onClick)

@Composable
private fun Badge(n: Int, modifier: Modifier = Modifier) {
    if (n <= 0) return
    val p = LocalPalette.current
    Box(modifier.size(22.dp).background(p.red, CircleShape).border(2.dp, p.chrome, CircleShape), contentAlignment = Alignment.Center) {
        T("$n", 12.sp, Color.White, bold = true)
    }
}

@Composable
private fun Divider(modifier: Modifier = Modifier) = Box(modifier.fillMaxWidth().height(1.dp).background(LocalPalette.current.line))

/** The design's name as people say it: the system's own name from the context view, else the file's. */
fun title(d: Design): String = d.context?.boxes?.firstOrNull { it.key.endsWith("#system") }?.name
    ?: d.name.replace('-', ' ').replaceFirstChar { it.uppercase() }

private fun viewKey(v: View) = when (v) { View.Context -> "context"; View.Api -> "api"; View.Screens -> "page"; View.Flows -> "flow"; else -> "system" }
private fun viewName(v: String) = when (v) { "context" -> "Context"; "api" -> "API"; "page" -> "Screens"; "flow" -> "Flows"; else -> "System" }

@Composable
fun App(session: Session) {
    val p = LocalPalette.current
    Box(Modifier.fillMaxSize().background(p.canvas)) {
        val d = session.design
        if (d == null) Connect(session.waiting ?: "Waiting for buni on the Mac")
        else if (session.view == View.Home) Home(session, d)
        else Workspace(session, d)
        session.toast?.let { t -> ToastBar(session, t, Modifier.align(Alignment.BottomCenter).windowInsetsPadding(WindowInsets.safeDrawing).padding(bottom = 84.dp)) }
    }
}

@Composable
private fun ToastBar(session: Session, t: Toast, modifier: Modifier) {
    val p = LocalPalette.current
    Row(modifier.semantics { liveRegion = LiveRegionMode.Polite }.background(if (p.dark) Color(0xFF3A3A3C) else Color(0xFF1C1C1E), RoundedCornerShape(20.dp))
        .padding(start = 20.dp, end = if (t.undo != null) 6.dp else 20.dp).height(52.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        T(t.text, 15.sp, Color.White)
        t.undo?.let { undo ->
            Box(Modifier.height(44.dp).clip(RoundedCornerShape(14.dp)).button("Undo") { session.dismissToast(); undo() }.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                T("Undo", 15.sp, Color(0xFF5EAAFF), bold = true)
            }
        }
    }
}

/** No design yet: how to get one, step by step, each step ticked as the tablet sees it happen. */
@Composable
private fun Connect(why: String) {
    val p = LocalPalette.current
    val context = LocalContext.current
    var plugged by remember { mutableStateOf(false) }
    var allowed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        while (true) {
            val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            plugged = battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) == BatteryManager.BATTERY_PLUGGED_USB
            allowed = Settings.Global.getInt(context.contentResolver, Settings.Global.ADB_ENABLED, 0) == 1
            delay(2_000)
        }
    }
    Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
        Column(Modifier.align(Alignment.Center).width(520.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Canvas(Modifier.size(320.dp, 110.dp)) {
                val u = size.width / 320f
                val s = androidx.compose.ui.graphics.drawscope.Stroke(2f * u)
                drawRoundRect(p.ink, Offset(30 * u, 10 * u), Size(128 * u, 86 * u), androidx.compose.ui.geometry.CornerRadius(10 * u), style = s)
                drawLine(p.ink, Offset(18 * u, 106 * u), Offset(170 * u, 106 * u), 2f * u)
                drawLine(p.green, Offset(170 * u, 60 * u), Offset(206 * u, 60 * u), 2.5f * u, pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(2 * u, 6 * u)))
                drawRoundRect(p.ink, Offset(214 * u, 4 * u), Size(104 * u, 104 * u), androidx.compose.ui.geometry.CornerRadius(12 * u), style = s)
                drawLine(p.red, Offset(250 * u, 88 * u), Offset(290 * u, 26 * u), 3f * u)
            }
            Spacer(Modifier.height(12.dp))
            T("Connect the USB cable to your Mac", 28.sp, bold = true, align = TextAlign.Center)
            T("buni works on the cable only, so your designs never leave the Mac.", 17.sp, p.ink2, align = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            Column(Modifier.fillMaxWidth().floating(12.dp)) {
                val steps = listOf(
                    Triple(plugged, "Plug in the cable", null),
                    Triple(allowed, "Tap Allow on the tablet", "Lets this Mac reach buni over USB"),
                    Triple(false, "Open the design on your Mac", if (why.startsWith("Waiting")) "In the buni editor, choose Open on tablet" else why),
                )
                steps.forEachIndexed { i, (done, label, hint) ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        if (done) Box(Modifier.size(28.dp).background(p.green, CircleShape), contentAlignment = Alignment.Center) { Icon(Glyph.Check, Color.White, 16.dp) }
                        else Box(Modifier.size(28.dp).border(1.5.dp, if (i == 2) p.accent else p.ink3, CircleShape), contentAlignment = Alignment.Center) { T("${i + 1}", 15.sp, if (i == 2) p.accentText else p.ink2, bold = true) }
                        Column(Modifier.weight(1f)) { T(label, 17.sp); hint?.let { T(it, 15.sp, p.ink2) } }
                        when {
                            done -> T("Done", 15.sp, p.green, bold = true)
                            i == 2 -> CircularProgressIndicator(Modifier.size(20.dp), color = p.accent, strokeWidth = 2.dp)
                        }
                    }
                    if (i < steps.size - 1) Divider()
                }
            }
        }
    }
}

@Composable
private fun Home(session: Session, d: Design) {
    val p = LocalPalette.current
    val tm = rememberTextMeasurer()
    val open = { v: String -> d.marks.count { it.view == v && it.state == "open" } }
    LaunchedEffect(d.version) { d.pages.take(4).forEach { session.page(it.id) } }
    Row(Modifier.fillMaxSize()) {
        // The sidebar: where to go, with how many open marks each place has.
        Column(Modifier.width(300.dp).fillMaxHeight().background(p.surface).windowInsetsPadding(WindowInsets.safeDrawing).padding(12.dp)) {
            Row(Modifier.fillMaxWidth().height(40.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                T("buni", 20.sp, bold = true)
                Spacer(Modifier.weight(1f))
                Icon(if (session.offline) Glyph.Unplug else Glyph.Cable, if (session.offline) p.ink2 else p.green, 18.dp)
                T(if (session.offline) "  Offline" else "  Connected", 15.sp, if (session.offline) p.ink2 else p.green)
            }
            Spacer(Modifier.height(8.dp))
            @Composable fun item(g: Glyph, label: String, n: Int, on: Boolean, go: () -> Unit) {
                Row(Modifier.fillMaxWidth().height(48.dp).background(if (on) p.accent else Color.Transparent, RoundedCornerShape(10.dp)).clip(RoundedCornerShape(10.dp))
                    .button(if (n > 0) "$label, $n open marks" else label, onClick = go).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Icon(g, if (on) Color.White else p.accentText, 22.dp)
                    T(label, 17.sp, if (on) Color.White else p.ink, bold = on, modifier = Modifier.weight(1f))
                    if (n > 0) T("$n", 15.sp, if (on) Color.White else p.ink2)
                }
            }
            item(Glyph.Grid, "Overview", 0, true) {}
            item(Glyph.Users, "Context", open("context"), false) { session.go(View.Context) }
            item(Glyph.Boxes, "System", open("system"), false) { session.go(View.System) }
            item(Glyph.Braces, "API", open("api"), false) { session.go(View.Api) }
            item(Glyph.Screens, "Screens", open("page"), false) { session.go(View.Screens) }
            item(Glyph.Route, "Flows", open("flow"), false) { session.go(View.Flows) }
            Divider(Modifier.padding(horizontal = 8.dp, vertical = 12.dp))
            item(Glyph.Checklist, "Marks", d.marks.count { it.state != "resolved" }, false) {
                // Marks live on their views: open the one with the most open marks, with its marks showing.
                val v = listOf(View.System to "system", View.Context to "context", View.Api to "api", View.Screens to "page", View.Flows to "flow").maxBy { open(it.second) }.first
                session.panel = Panel.Marks
                session.go(v)
            }
            Spacer(Modifier.weight(1f))
            Column(Modifier.fillMaxWidth().background(p.fill, RoundedCornerShape(12.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                T("Open on your Mac", 13.sp, p.ink2)
                T(d.file.substringAfterLast('/'), 15.sp, mono = true, lines = 1)
            }
        }
        Column(Modifier.weight(1f).fillMaxHeight().windowInsetsPadding(WindowInsets.safeDrawing).padding(horizontal = 32.dp, vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            val parts = d.system?.boxes?.count { it.tone != "planned" } ?: 0
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                T(title(d), 34.sp, bold = true)
                T("$parts parts · ${d.pages.size} screens · ${d.file.substringAfterLast('/')}", 17.sp, p.ink2)
            }
            d.plans.lastOrNull()?.let { plan ->
                val answered = d.marks.count { it.state == "addressed" }
                Row(Modifier.fillMaxWidth().background(p.tealTint, RoundedCornerShape(12.dp)).padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Icon(Glyph.Sparkles, p.teal, 26.dp)
                    Column(Modifier.weight(1f)) {
                        T(if (answered > 0) "Claude · Plan for your $answered mark${if (answered == 1) "" else "s"}" else "Claude · Plan", 13.sp, p.teal, bold = true)
                        T(plan.name, 17.sp, bold = true)
                        T("${plan.changes.size} proposed change${if (plan.changes.size == 1) "" else "s"} on System", 15.sp, p.ink2)
                    }
                    Box(Modifier.height(48.dp).background(p.accent, RoundedCornerShape(10.dp)).clip(RoundedCornerShape(10.dp)).button("Review the plan") { session.panel = Panel.Plan; session.go(View.System) }.padding(horizontal = 20.dp), contentAlignment = Alignment.Center) {
                        T("Review", 17.sp, Color.White, bold = true)
                    }
                }
            }
            @Composable fun card(modifier: Modifier, label: String, sub: String, n: Int, go: View, preview: @Composable BoxScope.() -> Unit) {
                Column(modifier.fillMaxHeight().shadow(if (p.dark) 0.dp else 6.dp, RoundedCornerShape(12.dp), ambientColor = Color(0x1F000000), spotColor = Color(0x1F000000))
                    .background(p.surface, RoundedCornerShape(12.dp)).border(if (p.dark) 1.dp else 0.dp, p.line, RoundedCornerShape(12.dp)).clip(RoundedCornerShape(12.dp))
                    .button(if (n > 0) "$label, $n open marks" else label) { session.go(go) }) {
                    Box(Modifier.fillMaxWidth().weight(1f).background(p.canvas)) {
                        preview()
                        Badge(n, Modifier.align(Alignment.TopEnd).padding(12.dp))
                    }
                    Column(Modifier.padding(16.dp)) { T(label, 20.sp, bold = true); T(sub, 15.sp, p.ink2, lines = 1) }
                }
            }
            @Composable fun map(m: MapData?) {
                if (m == null) return
                Canvas(Modifier.fillMaxSize().padding(16.dp)) {
                    val k = minOf(size.width / m.width, size.height / m.height)
                    translate((size.width - m.width * k) / 2, (size.height - m.height * k) / 2) { scale(k, k, Offset.Zero) { drawMap(m, p, tm, null) } }
                }
            }
            Row(Modifier.fillMaxWidth().weight(1f), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                card(Modifier.weight(1f), "Context", "Who uses it and what it relies on", open("context"), View.Context) { map(d.context) }
                card(Modifier.weight(1f), "System", "$parts parts and how they talk", open("system"), View.System) { map(d.system) }
            }
            Row(Modifier.fillMaxWidth().weight(1f), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                val a = d.api
                val ops = a?.cards?.sumOf { it.rows.size } ?: 0
                card(Modifier.weight(1f), "API", "${a?.cards?.size ?: 0} APIs, $ops operations", open("api"), View.Api) {
                    if (a != null) Canvas(Modifier.fillMaxSize().padding(16.dp)) {
                        val k = minOf(size.width / a.width, size.height / a.height)
                        translate((size.width - a.width * k) / 2, (size.height - a.height * k) / 2) { scale(k, k, Offset.Zero) { drawApi(a, p, tm, null) } }
                    }
                }
                val marked = d.pages.count { it.marks > 0 }
                card(Modifier.weight(1f), "Screens", "${d.pages.size} pages${if (marked > 0) " · $marked marked" else ""}", open("page"), View.Screens) {
                    Row(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        for (pg in d.pages.take(4)) {
                            val bmp = session.pages[pg.id]
                            Box(Modifier.weight(1f).fillMaxHeight().background(p.surface, RoundedCornerShape(8.dp)).border(1.dp, p.line, RoundedCornerShape(8.dp)).clip(RoundedCornerShape(8.dp))) {
                                if (bmp != null) Image(bmp.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alignment = Alignment.TopCenter)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Workspace(session: Session, d: Design) {
    val p = LocalPalette.current
    val context = LocalContext.current
    val haptics = LocalView.current
    val density = LocalDensity.current.density
    val still = remember { stillMotion(context) }
    val ink = remember { InkState() }
    val scope = rememberCoroutineScope()
    val layer = rememberGraphicsLayer()
    val cams = remember { mutableMapOf<String, Camera>() }
    var page by remember { mutableStateOf(d.pages.firstOrNull { it.marks > 0 }?.id ?: d.pages.firstOrNull()?.id) }
    var picked by remember { mutableStateOf<String?>(null) }
    var flow by remember { mutableStateOf(d.flows.firstOrNull()?.id) }
    // Walking a flow: the screen the person is on, and the ones they came through, for Back.
    var walk by remember { mutableStateOf<String?>(null) }
    val walked = remember { mutableStateListOf<String>() }
    // The flow's screen whose journey is open, and whether the list of flows is.
    var step by remember { mutableStateOf<String?>(null) }
    var flows by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    var colors by remember { mutableStateOf(false) }
    var flash by remember { mutableStateOf(emptySet<String>()) }
    // A walk is a page at a time: drawn, marked and sent like one, in the Flows tab.
    val walking = walk.takeIf { session.view == View.Flows }
    val walkFlow = d.flows.firstOrNull { it.id == flow }
    val stopWalking = { walk = null; walked.clear(); if (session.panel == Panel.Walk) session.panel = null }
    val walkTo = { to: String -> walking?.let { walked.add(it) }; walk = to; session.panel = Panel.Walk }
    val view = if (walking != null) "page" else viewKey(session.view)
    // What the view's marks are on: the page, or the flow.
    val pageId = when (view) { "page" -> walking ?: page; "flow" -> flow; else -> null }
    // Screens is the canvas once the Mac has laid it out: every page in its row, as in the editor; a walk shows one page.
    val canvas = session.canvas.takeIf { view == "page" && walking == null }
    var lit by remember { mutableStateOf<String?>(null) }
    val cam = cams.getOrPut(if (canvas != null) "canvas" else "$view/$pageId") { Camera() }
    val marks = if (canvas != null) d.marks.filter { it.state != "resolved" }.mapNotNull { m ->
        when (m.view) {
            // A page's marks, moved to where the page sits on the canvas.
            "page" -> canvas.boards.firstOrNull { it.page == m.page }?.let { b -> m.copy(strokes = m.strokes.map { it.moved(b.x, b.y) }, at = Offset(b.x, b.y)) }
            // A flow's, from its screen there onto that page here, scaled from the flow's size to the page's.
            // A sketch of a new screen: in the editor's canvas units, moved to here.
            "sketch" -> m.copy(strokes = m.strokes.map { it.moved(canvas.origin.x, canvas.origin.y) }, at = canvas.origin)
            "flow" -> {
                val s = d.flows.firstOrNull { it.id == m.page }?.screens?.firstOrNull { it.page == m.screen }
                val b = canvas.boards.firstOrNull { it.page == m.screen }
                if (s == null || b == null) null else {
                    val k = b.w / s.w
                    m.copy(strokes = m.strokes.map { st -> st.copy(width = st.width * k, points = FloatArray(st.points.size) { i -> if (i % 2 == 0) (st.points[i] - s.x) * k + b.x else (st.points[i] - s.y) * k + b.y }) })
                }
            }
            else -> null
        }
    } else d.marksOn(view, pageId)
    // Strokes on the canvas go to the page under where they start, in its own pixels; started on empty canvas,
    // they're a sketch of a new screen, kept where they were drawn for Claude to build there.
    SideEffect {
        ink.placeOn = canvas?.let { c -> { list ->
            val first = list.firstOrNull()?.points
            val at = if (first != null && first.size >= 2) Offset(first[0], first[1]) else Offset.Zero
            c.boardAt(at)?.let { b -> Placed("page", b.page, list.map { it.moved(-b.x, -b.y) }) }
                ?: Placed("sketch", null, list.map { it.moved(-c.origin.x, -c.origin.y) })
        } }
    }
    val plan = d.plans.lastOrNull()
    val proposed = plan?.changes?.map { it.id }?.toSet() ?: emptySet()
    // A panel that doesn't belong to this view closes when the view changes.
    var panel = session.panel
    if (panel == Panel.Operation && (view != "api" || picked == null)) panel = null
    if (panel == Panel.Plan && (plan == null || view == "page" || view == "api" || view == "flow")) panel = null
    if (panel == Panel.Step && (view != "flow" || step == null)) panel = null
    if (panel == Panel.Walk && walking == null) panel = null
    if (panel == null && walking != null && session.panel == Panel.Walk) panel = Panel.Walk
    if (panel == Panel.Drafting && session.drafting == null) panel = null
    if (panel != session.panel) session.panel = panel
    val left = !session.leftHanded
    val inspector = panel != null

    // The room the content fits into: what the floating chrome leaves of the screen.
    cam.pad = Rect(
        (if (left) 88f else 12f) * density, 76f * density,
        ((if (inspector) 364f else 12f) + (if (left) 0f else 76f)) * density, 76f * density,
    )
    if (!cam.moved && cam.size.width > 0) cam.xf = cam.fitted()

    // Back closes the topmost thing first: a popover, then the panel, then the view.
    BackHandler {
        when {
            more -> more = false
            colors -> colors = false
            flows -> flows = false
            walking != null -> if (walked.isNotEmpty()) walk = walked.removeAt(walked.lastIndex) else stopWalking()
            session.panel != null -> { session.panel = null; picked = null; step = null }
            else -> session.go(View.Home)
        }
    }

    val send = {
        scope.launch {
            val pic = picture(layer)
            val r = session.ask { it.send(if (canvas != null) "screens" else view, pageId, pic) } ?: return@launch
            if (view == "page" || view == "flow") { if (r.copied) session.say("On your Mac's clipboard: paste it into Claude Code.") }
            else { session.drafting = Drafting(view, r.count, r.copied); session.panel = Panel.Drafting }
        }
        Unit
    }

    Box(Modifier.fillMaxSize()) {
        // The canvas, full bleed under everything else.
        when (view) {
            "context", "system" -> {
                val m = if (view == "context") d.context else d.system
                if (m == null) Empty("Nothing drawn at this level yet. Sketch a part or a person, and ask Claude for a plan.")
                Board(session, ink, cam, view, null, Size(m?.width ?: 1000f, m?.height ?: 700f), marks, layer, { boxAt(m, it) }, { picked = boxAt(m, it) }) { pal, tm -> m?.let { drawMap(it, pal, tm, picked, proposed, flash) } }
            }
            "api" -> {
                val a = d.api
                if (a == null || a.cards.isEmpty()) Empty("No API designed yet. Your agent writes it with set_api and set_operation.")
                Board(session, ink, cam, view, null, Size(a?.width ?: 1000f, a?.height ?: 600f), marks, layer, { apiOnAt(a, it) }, {
                    picked = apiRowAt(a, it)?.op
                    session.panel = if (picked != null) Panel.Operation else if (session.panel == Panel.Operation) null else session.panel
                }) { pal, tm -> a?.let { drawApi(it, pal, tm, picked) } }
            }
            "flow" -> {
                val f = d.flows.firstOrNull { it.id == flow }
                if (f == null) Empty("No flows yet. Your agent names one with set_flow, from the page it starts on.")
                LaunchedEffect(f?.id, d.version) { f?.screens?.forEach { session.page(it.page) } }
                val images = f?.screens?.mapNotNull { s -> session.pages[s.page]?.let { s.page to it } }?.toMap() ?: emptyMap()
                val bitmaps = remember(images) { images.mapValues { it.value.asImageBitmap() } }
                Board(session, ink, cam, view, f?.id, Size(f?.width ?: 1000f, f?.height ?: 700f), marks, layer, { flowScreenAt(f, it) }, {
                    step = flowScreenAt(f, it)
                    session.panel = if (step != null) Panel.Step else if (session.panel == Panel.Step) null else session.panel
                }) { pal, tm -> f?.let { drawFlow(it, pal, tm, bitmaps, step) } }
            }
            else -> if (canvas != null) {
                LaunchedEffect(canvas, d.version) { canvas.boards.forEach { session.page(it.page) } }
                val images = canvas.boards.mapNotNull { b -> session.pages[b.page]?.let { b.page to it } }.toMap()
                val bitmaps = remember(images) { images.mapValues { it.value.asImageBitmap() } }
                Board(session, ink, cam, "canvas", null, Size(canvas.width, canvas.height), marks, layer, { null }, { lit = canvas.boardAt(it)?.page }) { pal, tm ->
                    drawCanvas(canvas, pal, tm, bitmaps, lit, density / cam.xf.k)
                    sketchTags(marks.filter { it.view == "sketch" }, pal, tm, density / cam.xf.k)
                }
            } else {
                // A page: the one picked in Screens, or the screen a walk is on (a state isn't in Screens' list).
                val id = pageId
                val pg = d.pages.firstOrNull { it.id == id }
                LaunchedEffect(id, d.version) { id?.let { session.page(it) } }
                val bmp = id?.let { session.pages[it] }
                // Drawn at 1×: the picture is as wide as the page.
                val w = pg?.width ?: bmp?.width?.toFloat() ?: 390f
                val h = if (bmp != null) bmp.height * w / bmp.width else 844f
                val image = remember(bmp) { bmp?.asImageBitmap() }
                Board(session, ink, cam, view, id, Size(w, h), marks, layer, { null }) { pal, _ ->
                    drawRect(pal.surface, Offset.Zero, Size(w, h))
                    drawRect(pal.line, Offset.Zero, Size(w, h), style = androidx.compose.ui.graphics.drawscope.Stroke(1f))
                    image?.let { drawImage(it, dstSize = IntSize(w.toInt(), h.toInt())) }
                }
            }
        }

        Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(12.dp)) {
            TopBar(session, d, marks.count { it.state == "open" }, panel == Panel.Marks, onMarks = { session.panel = if (panel == Panel.Marks) null else Panel.Marks; picked = null }, onMore = { more = !more; colors = false })
            if (session.offline) Row(Modifier.align(Alignment.TopCenter).padding(top = 68.dp, end = if (inspector) 352.dp else 0.dp).widthIn(max = 600.dp).floating(20.dp).padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Icon(Glyph.Unplug, p.ink, 20.dp)
                T("Not connected to your Mac. You're looking at the last copy; it updates when you plug back in.", 15.sp, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }

            val railEnd = if (inspector) 352.dp else 0.dp
            Rail(session, ink, marks, view, pageId, colors, { colors = !colors; more = false },
                if (left) Modifier.align(Alignment.CenterStart) else Modifier.align(Alignment.CenterEnd).padding(end = railEnd))
            if (colors) ColorPopover(ink, { colors = false }, if (left) Modifier.align(Alignment.CenterStart).padding(start = 76.dp, top = 150.dp) else Modifier.align(Alignment.CenterEnd).padding(end = railEnd + 76.dp, top = 150.dp))

            if (view == "page" && walking == null && d.pages.size > 1) {
                // On the canvas the list goes to a page there; without it, it picks the one page shown.
                Row(Modifier.align(Alignment.BottomStart).padding(start = if (left) 76.dp else 0.dp, end = if (inspector) 600.dp else 240.dp).floating(24.dp).padding(4.dp).horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (it in d.pages) {
                        val on = it.id == page
                        Row(Modifier.height(48.dp).background(if (on) p.fill else Color.Transparent, RoundedCornerShape(20.dp)).clip(RoundedCornerShape(20.dp)).button("${it.name}${if (it.marks > 0) ", ${it.marks} marks" else ""}${if (on) ", selected" else ""}") {
                            page = it.id
                            canvas?.boards?.firstOrNull { b -> b.page == it.id }?.let { b -> lit = b.page; scope.launch { cam.moved = true; cam.go(cam.framing(Rect(b.x, b.y, b.x + b.w, b.y + b.h)), still) } }
                        }.padding(horizontal = 16.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            T(it.name, 15.sp, if (on) p.ink else p.ink2, bold = on, lines = 1)
                            if (it.marks > 0) T("${it.marks}", 15.sp, p.red, bold = true)
                        }
                    }
                }
            }

            // Which flow: its name and size, and the others to switch to.
            // Walking: which flow, Done; a way back; the steps, the one it's on lit.
            if (walking != null && walkFlow != null) {
                Row(Modifier.align(Alignment.TopStart).padding(top = 68.dp).height(48.dp).floating(16.dp).padding(start = 14.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Glyph.Play, p.accentText, 16.dp)
                    T("Walking ${walkFlow.name}", 15.sp, bold = true, lines = 1)
                    Box(Modifier.height(40.dp).background(p.fill, RoundedCornerShape(12.dp)).clip(RoundedCornerShape(12.dp)).button("Done walking", onClick = stopWalking).padding(horizontal = 14.dp), contentAlignment = Alignment.Center) { T("Done", 15.sp, bold = true) }
                }
                if (walked.isNotEmpty()) Box(Modifier.align(Alignment.CenterStart).padding(start = if (left) 88.dp else 12.dp).size(48.dp).floating(24.dp)
                    .button("Back to ${walkFlow.screens.firstOrNull { it.page == walked.last() }?.name ?: "the last screen"}") { walk = walked.removeAt(walked.lastIndex) }, contentAlignment = Alignment.Center) { Icon(Glyph.Back, p.ink, 22.dp) }
                val steps = walkFlow.screens.filter { it.step != null }
                val at = steps.indexOfFirst { it.page == walking }
                Row(Modifier.align(Alignment.BottomCenter).padding(end = if (inspector) 352.dp else 0.dp).floating(24.dp).padding(6.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    steps.forEachIndexed { i, st ->
                        val on = st.page == walking
                        val done = at >= 0 && i < at
                        Row(Modifier.height(40.dp).background(if (on) p.accentTint else Color.Transparent, RoundedCornerShape(20.dp)).clip(RoundedCornerShape(20.dp))
                            .button("Step ${i + 1}, ${st.name}${if (on) ", here" else ""}") { if (!on) walkTo(st.page) }.padding(horizontal = 12.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Box(Modifier.size(20.dp).background(if (on) p.accent else if (done) p.green else p.fill, CircleShape), contentAlignment = Alignment.Center) {
                                if (done) Icon(Glyph.Check, Color.White, 12.dp) else T("${i + 1}", 12.sp, if (on) Color.White else p.ink2, bold = true)
                            }
                            T(st.name, 14.sp, if (on || done) p.ink else p.ink2, bold = on, lines = 1)
                        }
                    }
                }
            }

            if (view == "flow") d.flows.firstOrNull { it.id == flow }?.let { f ->
                Column(Modifier.align(Alignment.TopStart).padding(top = 68.dp)) {
                    val steps = f.screens.count { it.step != null }
                    Row(Modifier.height(48.dp).floating(16.dp).button(if (d.flows.size > 1) "Flow ${f.name}, change flow" else "Flow ${f.name}", enabled = d.flows.size > 1) { flows = !flows }.padding(horizontal = 14.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Glyph.Route, p.ink2, 18.dp)
                        T(f.name, 16.sp, bold = true, lines = 1)
                        if (d.flows.size > 1) Icon(Glyph.Down, p.ink2, 16.dp)
                        T("$steps steps · ${f.screens.size - steps} other screens", 13.sp, p.ink2, lines = 1)
                        f.screens.firstOrNull { it.step == 1 }?.let { first ->
                            Box(Modifier.height(40.dp).background(p.accent, RoundedCornerShape(12.dp)).clip(RoundedCornerShape(12.dp)).button("Walk ${f.name}") { flows = false; step = null; walked.clear(); walkTo(first.page) }.padding(horizontal = 14.dp),
                                contentAlignment = Alignment.Center) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { Icon(Glyph.Play, Color.White, 14.dp); T("Walk it", 15.sp, Color.White, bold = true) }
                            }
                        }
                    }
                    if (flows) Column(Modifier.padding(top = 8.dp).width(320.dp).floating(14.dp).padding(vertical = 4.dp)) {
                        for (o in d.flows) Row(Modifier.fillMaxWidth().height(48.dp).button(if (o.id == flow) "${o.name}, selected" else o.name) {
                            flow = o.id; step = null; flows = false
                            if (session.panel == Panel.Step) session.panel = null
                        }.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                            T(o.name, 16.sp, if (o.id == flow) p.accentText else p.ink, bold = o.id == flow, modifier = Modifier.weight(1f), lines = 1)
                            val n = d.marksOn("flow", o.id).size
                            if (n > 0) T("$n", 15.sp, p.red, bold = true)
                        }
                    }
                }
            }

            ZoomBar(cam, still, Modifier.align(Alignment.BottomEnd).padding(end = if (inspector) 352.dp else if (left) 0.dp else 76.dp))

            Tips(session, Modifier.align(if (left) Alignment.TopStart else Alignment.TopEnd).padding(top = 200.dp, start = if (left) 76.dp else 0.dp, end = if (left) 0.dp else 76.dp),
                Modifier.align(Alignment.BottomCenter).padding(bottom = 80.dp))

            // The inspector: one panel at a time, on the trailing edge.
            var last by remember { mutableStateOf(panel) }
            if (panel != null) last = panel
            AnimatedVisibility(panel != null, Modifier.align(Alignment.TopEnd).padding(top = 68.dp),
                enter = slideInHorizontally(spring(dampingRatio = 0.86f, stiffness = 400f)) { it / 3 } + fadeIn(spring(stiffness = 400f)),
                exit = slideOutHorizontally(spring(dampingRatio = 0.86f, stiffness = 400f)) { it / 3 } + fadeOut(spring(stiffness = 400f))) {
                Column(Modifier.width(340.dp).fillMaxHeight().floating(20.dp).padding(20.dp)) {
                    val close = { session.panel = null; picked = null; step = null; if (walking != null) stopWalking() }
                    when (last) {
                        Panel.Marks -> MarksPanel(session, d, if (canvas != null) "screens" else view, pageId, marks, close, send) { m ->
                            scope.launch { cam.moved = true; cam.go(cam.showing(markBounds(m)), still) }
                        }
                        Panel.Plan -> if (plan != null) PlanPanel(session, plan, d, close) { kept ->
                            haptics.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                            flash = kept
                            scope.launch { delay(600); flash = emptySet() }
                        }
                        Panel.Drafting -> session.drafting?.let { DraftingPanel(session, it, close) }
                        Panel.Step -> step?.let { s -> d.flows.firstOrNull { it.id == flow }?.let { f -> StepPanel(f, s, close) } }
                        Panel.Walk -> walking?.let { s -> walkFlow?.let { f -> StepPanel(f, s, close, walkTo) } }
                        Panel.Operation -> d.api?.let { a -> a.cards.firstNotNullOfOrNull { c -> c.rows.firstOrNull { it.op == picked }?.let { c to it } }?.let { (c, r) -> OperationPanel(a, c, r, close) } }
                        null -> {}
                    }
                }
            }

            if (more) {
                Box(Modifier.fillMaxSize().clickable(remember { MutableInteractionSource() }, null) { more = false })
                More(session, Modifier.align(Alignment.TopEnd).padding(top = 64.dp)) { more = false }
            }
        }
    }
}

@Composable
private fun TopBar(session: Session, d: Design, marks: Int, marksOpen: Boolean, onMarks: () -> Unit, onMore: () -> Unit) {
    val p = LocalPalette.current
    Box(Modifier.fillMaxWidth().height(56.dp)) {
        Row(Modifier.align(Alignment.CenterStart).height(56.dp).floating(28.dp).button("Back to Home, ${title(d)}") { session.go(View.Home) }.padding(start = 12.dp, end = 20.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(Glyph.Back, p.ink, 22.dp); T(title(d), 17.sp, lines = 1)
        }
        Row(Modifier.align(Alignment.Center).floating(16.dp).padding(4.dp)) {
            Row(Modifier.background(p.fill, RoundedCornerShape(12.dp)).padding(2.dp)) {
                for ((v, label) in listOf(View.Context to "Context", View.System to "System", View.Api to "API", View.Screens to "Screens", View.Flows to "Flows")) {
                    val on = session.view == v
                    Box(Modifier.width(106.dp).height(44.dp).then(if (on) Modifier.shadow(if (p.dark) 0.dp else 2.dp, RoundedCornerShape(10.dp)).background(if (p.dark) Color(0xFF636366) else p.surface, RoundedCornerShape(10.dp)) else Modifier)
                        .clip(RoundedCornerShape(10.dp)).button(if (on) "$label, selected" else label) { session.go(v) }, contentAlignment = Alignment.Center) {
                        T(label, 17.sp, if (on) p.ink else p.ink2, bold = on)
                    }
                }
            }
        }
        Row(Modifier.align(Alignment.CenterEnd).height(56.dp).floating(28.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(48.dp).clip(CircleShape).background(if (marksOpen) p.accent else Color.Transparent).button(if (marks > 0) "Marks, $marks" else "Marks", onClick = onMarks), contentAlignment = Alignment.Center) {
                Icon(Glyph.Checklist, if (marksOpen) Color.White else p.ink, 22.dp)
            }
            Box(Modifier.size(48.dp).clip(CircleShape).button("More", onClick = onMore), contentAlignment = Alignment.Center) { Icon(Glyph.More, p.ink, 22.dp) }
        }
        Badge(marks, Modifier.align(Alignment.TopEnd).offset(x = (-58).dp, y = 4.dp))
    }
}

private val INKS = listOf("#d70015" to "Red", "#0071e3" to "Blue", "#1d7a34" to "Green", "#1c1c1e" to "Black")

@Composable
private fun Rail(session: Session, ink: InkState, marks: List<Mark>, view: String, page: String?, colorsOpen: Boolean, onColors: () -> Unit, modifier: Modifier) {
    val p = LocalPalette.current
    val haptics = LocalView.current
    Column(modifier.width(64.dp).floating(24.dp).padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        @Composable fun tool(t: Tool, g: Glyph, label: String) {
            val on = ink.tool == t
            Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(if (on) p.accent else Color.Transparent)
                .button(if (on) "$label, selected" else label) { if (!on) { ink.pick(t); haptics.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) } }, contentAlignment = Alignment.Center) {
                Icon(g, if (on) Color.White else p.ink, 24.dp)
                if (on && (t == Tool.Pen || t == Tool.Note)) Box(Modifier.align(Alignment.BottomEnd).padding(10.dp).size(10.dp).background(cssColor(ink.color, p), CircleShape).border(1.5.dp, Color.White, CircleShape))
            }
        }
        tool(Tool.Pen, Glyph.Pen, "Pen"); tool(Tool.Highlighter, Glyph.Highlighter, "Highlighter"); tool(Tool.Eraser, Glyph.Eraser, "Eraser"); tool(Tool.Lasso, Glyph.Lasso, "Lasso"); tool(Tool.Note, Glyph.Note, "Typed note")
        Box(Modifier.width(36.dp).height(1.dp).background(p.line))
        val name = INKS.firstOrNull { it.first == ink.color }?.second ?: "Ink"
        Box(Modifier.size(56.dp).clip(CircleShape).button("Colour: $name", onClick = onColors), contentAlignment = Alignment.Center) {
            Box(Modifier.size(32.dp).border(2.dp, if (colorsOpen) p.accent else p.line, CircleShape).padding(3.dp).background(inkColor(ink.color, p), CircleShape))
        }
        Box(Modifier.width(36.dp).height(1.dp).background(p.line))
        Box(Modifier.size(56.dp).clip(CircleShape).button("Undo", enabled = ink.canUndo) { undo(session, ink, marks) }, contentAlignment = Alignment.Center) { Icon(Glyph.Undo, if (ink.canUndo) p.ink else p.ink3.copy(alpha = .4f), 22.dp) }
        Box(Modifier.size(56.dp).clip(CircleShape).button("Redo", enabled = ink.undone.isNotEmpty()) { redo(session, ink, view, page) }, contentAlignment = Alignment.Center) { Icon(Glyph.Redo, if (ink.undone.isNotEmpty()) p.ink else p.ink3.copy(alpha = .4f), 22.dp) }
    }
}

/** Black ink shows as the theme's ink, so it stays visible in dark mode. */
private fun inkColor(c: String, p: Palette) = if (c == "#1c1c1e") p.ink else cssColor(c, p)

@Composable
private fun ColorPopover(ink: InkState, close: () -> Unit, modifier: Modifier) {
    val p = LocalPalette.current
    Row(modifier.floating(14.dp).padding(6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for ((c, name) in INKS) {
            val on = ink.color == c
            Box(Modifier.size(48.dp).clip(CircleShape).button(if (on) "$name, selected" else name) { ink.color = c; if (ink.tool !in setOf(Tool.Pen, Tool.Note)) ink.pick(Tool.Pen); close() }, contentAlignment = Alignment.Center) {
                Box(Modifier.size(34.dp).border(2.dp, if (on) p.accent else Color.Transparent, CircleShape).padding(4.dp).background(inkColor(c, p), CircleShape))
            }
        }
    }
}

@Composable
private fun ZoomBar(cam: Camera, still: Boolean, modifier: Modifier) {
    val p = LocalPalette.current
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current.density
    Row(modifier.height(56.dp).floating(28.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(48.dp).clip(CircleShape).button("Zoom out") { scope.launch { cam.moved = true; cam.go(cam.zoomed(1 / 1.25f), still) } }, contentAlignment = Alignment.Center) { Icon(Glyph.Minus, p.ink, 20.dp) }
        T("${(cam.xf.k / density * 100).roundToInt()}%", 17.sp, align = TextAlign.Center, modifier = Modifier.width(56.dp))
        Box(Modifier.size(48.dp).clip(CircleShape).button("Zoom in") { scope.launch { cam.moved = true; cam.go(cam.zoomed(1.25f), still) } }, contentAlignment = Alignment.Center) { Icon(Glyph.Plus, p.ink, 20.dp) }
        Box(Modifier.width(1.dp).height(28.dp).background(p.line))
        Box(Modifier.size(48.dp).clip(CircleShape).button("Fit to screen") { scope.launch { cam.go(cam.fitted(), still); cam.moved = false } }, contentAlignment = Alignment.Center) { Icon(Glyph.Fit, p.ink, 20.dp) }
    }
}

@Composable
private fun Tips(session: Session, penAt: Modifier, fingersAt: Modifier) {
    val p = LocalPalette.current
    @Composable fun tip(id: String, head: String, body: String, at: Modifier) {
        if (id in session.tipsSeen) return
        Column(at.width(280.dp).floating(14.dp).padding(16.dp).semantics { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            T(head, 17.sp, bold = true)
            T(body, 15.sp, p.ink2)
            Box(Modifier.align(Alignment.End).height(44.dp).clip(RoundedCornerShape(10.dp)).button("Got it") { session.tipSeen(id) }.padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
                T("Got it", 17.sp, p.accentText, bold = true)
            }
        }
    }
    tip("pen", "The S Pen draws right away", "Touch anywhere and sketch. Hold the pen's button to erase; click it while hovering to go back to the last tool.", penAt)
    tip("fingers", "Fingers move the map", "Drag to pan, pinch to zoom. Two-finger tap undoes, three-finger tap redoes.", fingersAt)
}

@Composable
private fun More(session: Session, modifier: Modifier, close: () -> Unit) {
    val p = LocalPalette.current
    Column(modifier.width(320.dp).floating(14.dp)) {
        @Composable fun row(g: Glyph, label: String, color: Color, desc: String, trailing: @Composable () -> Unit = {}, onClick: (() -> Unit)?) {
            Row(Modifier.fillMaxWidth().height(52.dp).then(if (onClick != null) Modifier.button(desc, onClick = onClick) else Modifier.semantics(mergeDescendants = true) { contentDescription = desc }).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Icon(g, color, 22.dp); T(label, 17.sp, color, modifier = Modifier.weight(1f)); trailing()
            }
        }
        row(Glyph.Hand, "Left-handed tools", p.ink, "Left-handed tools, ${if (session.leftHanded) "on" else "off"}", { Switch(session.leftHanded) }) { session.leftHand(!session.leftHanded) }
        Divider()
        row(Glyph.Bulb, "Show tips again", p.ink, "Show tips again") { session.showTipsAgain(); close() }
        Divider()
        row(Glyph.Contrast, "Appearance", p.ink, "Appearance follows the tablet", { T("Follows the tablet", 15.sp, p.ink2) }, null)
        Divider()
        row(Glyph.Unplug, "Disconnect from the Mac", if (p.dark) p.red else p.destructive, "Disconnect from the Mac") { close(); session.disconnect() }
    }
}

@Composable
private fun Switch(on: Boolean) {
    val p = LocalPalette.current
    Box(Modifier.width(51.dp).height(31.dp).background(if (on) p.green else p.fill, CircleShape).padding(2.dp), contentAlignment = if (on) Alignment.CenterEnd else Alignment.CenterStart) {
        Box(Modifier.size(27.dp).shadow(2.dp, CircleShape).background(Color.White, CircleShape))
    }
}

/** The inspector's header: Claude's kicker when it is Claude's, a title, a line under it, and close. */
@Composable
private fun Head(title: String, sub: String?, close: () -> Unit, kicker: Boolean = false) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (kicker) Row(verticalAlignment = Alignment.CenterVertically) { Icon(Glyph.Sparkles, p.teal, 16.dp); T("  Claude · Plan", 13.sp, p.teal, bold = true) }
            T(title, 22.sp, bold = true)
            sub?.let { T(it, 15.sp, p.ink2) }
        }
        Box(Modifier.offset(x = 12.dp, y = (-8).dp).size(48.dp).clip(CircleShape).button("Close", onClick = close), contentAlignment = Alignment.Center) { Icon(Glyph.Close, p.ink2, 20.dp) }
    }
}

/** A mark drawn small: its strokes scaled into a thumbnail. */
@Composable
private fun Thumb(m: Mark, w: Dp, h: Dp) {
    val p = LocalPalette.current
    Canvas(Modifier.size(w, h).background(p.fill, RoundedCornerShape(8.dp)).clip(RoundedCornerShape(8.dp))) {
        val b = markBounds(m)
        val pad = 6.dp.toPx()
        val k = minOf((size.width - pad * 2) / maxOf(b.width, 1f), (size.height - pad * 2) / maxOf(b.height, 1f), 2f)
        translate((size.width - b.width * k) / 2 - b.left * k, (size.height - b.height * k) / 2 - b.top * k) {
            scale(k, k, Offset.Zero) {
                // Thin enough to read at any scale: each line keeps about 2 dp on screen.
                strokes(m.strokes.map { it.copy(width = 2.dp.toPx() / k) }, p, answered = m.state == "addressed")
            }
        }
    }
}

private fun words(m: Mark) = if (m.said.startsWith("Drew ")) "Handwritten mark" else "“${m.said}”"

@Composable
private fun ColumnScope.MarksPanel(session: Session, d: Design, view: String, page: String?, marks: List<Mark>, close: () -> Unit, send: () -> Unit, show: (Mark) -> Unit) {
    val p = LocalPalette.current
    val density = LocalDensity.current.density
    val where = when (view) { "page" -> d.pages.firstOrNull { it.id == page }?.name ?: "this page"; "flow" -> d.flows.firstOrNull { it.id == page }?.name ?: "this flow"; "screens" -> "Screens"; else -> viewName(view) }
    Head("Marks", "${marks.size} on $where", close)
    Column(Modifier.weight(1f).padding(top = 12.dp).verticalScroll(rememberScrollState())) {
        if (marks.isEmpty()) T("Draw on the ${when (view) { "page" -> "page"; "flow" -> "flow"; else -> "map" }} with the S Pen. Each sketch becomes a mark here.", 15.sp, p.ink2, modifier = Modifier.padding(vertical = 12.dp))
        for (m in marks) key(m.id) {
            var dx by remember { mutableStateOf(0f) }
            // Deleting is one step back: the toast's Undo draws the mark again.
            val remove = {
                session.call { it.erase(m.id) }
                session.say("Mark deleted.") { session.call { it.mark(m.view, m.page, m.on, m.strokes.map { s -> s.moved(-m.at.x, -m.at.y) }, m.said.takeUnless { s -> s.startsWith("Drew ") }) } }
            }
            Row(Modifier.fillMaxWidth().offset { IntOffset(dx.roundToInt(), 0) }
                .pointerInput(Unit) { detectHorizontalDragGestures(onDragEnd = { if (dx < -160f * density && !session.offline) remove() else dx = 0f }, onDragCancel = { dx = 0f }) { ch, by -> ch.consume(); dx = (dx + by).coerceAtMost(0f) } }
                .button("${words(m)}, ${m.onName ?: m.kind}${if (m.state == "addressed") ", answered" else ""}") { show(m) }.padding(vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Thumb(m, 88.dp, 56.dp)
                Column(Modifier.weight(1f)) {
                    T(words(m), 17.sp, lines = 2)
                    T(listOfNotNull(m.onName ?: m.kind, if (m.state == "addressed") "Answered" else null).joinToString(" · "), 15.sp, p.ink2, lines = 1)
                }
                Box(Modifier.size(44.dp).clip(CircleShape).button("Delete mark", enabled = !session.offline, onClick = remove), contentAlignment = Alignment.Center) { Icon(Glyph.Close, p.ink3, 18.dp) }
            }
            Divider()
        }
    }
    val n = marks.count { it.state == "open" }
    val sketched = marks.any { it.view == "sketch" && it.state == "open" }
    val label = if (sketched) "Build sketched screens with Claude" else if (view == "page" || view == "flow" || view == "screens") "Send $n mark${if (n == 1) "" else "s"} to Claude" else "Ask Claude for a plan"
    val ok = n > 0 && !session.offline
    Box(Modifier.padding(top = 12.dp).fillMaxWidth().height(52.dp).background(if (ok) p.accent else p.fill, RoundedCornerShape(10.dp)).clip(RoundedCornerShape(10.dp)).button(label, enabled = ok, onClick = send), contentAlignment = Alignment.Center) {
        Row(verticalAlignment = Alignment.CenterVertically) { Icon(Glyph.Sparkles, if (ok) Color.White else p.ink3, 20.dp); T("  $label", 17.sp, if (ok) Color.White else p.ink3, bold = true) }
    }
}

@Composable
private fun ColumnScope.PlanPanel(session: Session, plan: Plan, d: Design, close: () -> Unit, accepted: (Set<String>) -> Unit) {
    val p = LocalPalette.current
    // Removals start unticked and need ticking (the Mac can only leave additions out); additions start ticked.
    val off = remember(plan.id) { mutableStateListOf<String>().apply { addAll(plan.changes.filter { it.change == "remove" }.map { it.id }) } }
    val kept = plan.changes.filter { it.id !in off }
    val removalOff = plan.changes.any { it.change == "remove" && it.id in off }
    Head(plan.name, null, close, kicker = true)
    Column(Modifier.weight(1f).padding(top = 12.dp).verticalScroll(rememberScrollState())) {
        plan.about?.let { Box(Modifier.fillMaxWidth().background(p.fill, RoundedCornerShape(12.dp)).padding(14.dp)) { T(it, 17.sp) } }
        Spacer(Modifier.height(8.dp))
        for (c in plan.changes) {
            val on = c.id !in off
            val remove = c.change == "remove"
            val source = d.marks.firstOrNull { it.on == c.id }
            Row(Modifier.fillMaxWidth().background(if (on) p.accentTint else Color.Transparent, RoundedCornerShape(10.dp)).clip(RoundedCornerShape(10.dp))
                .button("${if (remove) "Remove" else "Add"}: ${c.title}, ${if (on) "kept" else "left out"}") { if (on) off.add(c.id) else off.remove(c.id) }.padding(12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(24.dp).background(if (on) p.accent else Color.Transparent, RoundedCornerShape(6.dp)).border(1.5.dp, if (on) p.accent else p.ink3, RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
                    if (on) Icon(Glyph.Check, Color.White, 16.dp)
                }
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    T(if (remove) "Remove ${c.title}" else c.title, 17.sp, if (remove) p.red else p.ink, bold = true)
                    c.detail?.let { T(it, 15.sp, p.ink2) }
                    source?.let { m -> Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { Thumb(m, 44.dp, 28.dp); T("From your mark", 13.sp, p.ink2) } }
                }
            }
        }
    }
    T(if (removalOff) "Tick each removal to accept: only additions can be left out." else "Claude can be wrong. Check each change on the map.", 13.sp, p.ink2, modifier = Modifier.padding(vertical = 12.dp))
    val ok = kept.isNotEmpty() && !removalOff && !session.offline
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.weight(.8f).height(52.dp).background(p.fill, RoundedCornerShape(10.dp)).clip(RoundedCornerShape(10.dp)).button("Discard the plan", enabled = !session.offline) {
            close(); session.call { it.plan(plan.id, "discard") }
        }, contentAlignment = Alignment.Center) { T("Discard", 17.sp, bold = true) }
        val label = "Accept ${kept.size} change${if (kept.size == 1) "" else "s"}"
        Box(Modifier.weight(1.2f).height(52.dp).background(if (ok) p.accent else p.fill, RoundedCornerShape(10.dp)).clip(RoundedCornerShape(10.dp)).button(label, enabled = ok) {
            val skip = off.toList()
            close()
            session.call({ accepted(kept.map { it.id }.toSet()) }) { it.plan(plan.id, "merge", skip) }
        }, contentAlignment = Alignment.Center) { T(label, 17.sp, if (ok) Color.White else p.ink3, bold = true) }
    }
}

@Composable
private fun ColumnScope.DraftingPanel(session: Session, dr: Drafting, close: () -> Unit) {
    val p = LocalPalette.current
    val n = "${dr.count} mark${if (dr.count == 1) "" else "s"}"
    Head("Drafting a plan", "From your $n on ${viewName(dr.view)}", close, kicker = true)
    Column(Modifier.weight(1f).padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        // 2 done, 1 under way, 0 still to come.
        @Composable fun step(state: Int, words: String) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) {
                    when (state) {
                        2 -> Box(Modifier.size(22.dp).border(1.5.dp, p.green, CircleShape), contentAlignment = Alignment.Center) { Icon(Glyph.Check, p.green, 14.dp) }
                        1 -> CircularProgressIndicator(Modifier.size(20.dp), color = p.teal, strokeWidth = 2.dp)
                        else -> Box(Modifier.size(20.dp).border(1.5.dp, p.ink3, CircleShape))
                    }
                }
                T(words, 17.sp, if (state == 0) p.ink2 else p.ink, bold = state == 1)
            }
        }
        step(2, "Sent your $n and a picture of them")
        step(if (dr.copied) 2 else 0, "On your Mac's clipboard: paste it into Claude Code")
        step(1, "Claude drafts a plan")
        step(0, "The plan opens here for you to review")
        Box(Modifier.fillMaxWidth().background(p.fill, RoundedCornerShape(12.dp)).padding(14.dp)) { T("Keep sketching. New marks go with the next plan.", 15.sp, p.ink2) }
    }
    Box(Modifier.fillMaxWidth().height(52.dp).background(p.fill, RoundedCornerShape(10.dp)).clip(RoundedCornerShape(10.dp)).button("Stop waiting for the plan") { session.drafting = null; session.panel = Panel.Marks }, contentAlignment = Alignment.Center) {
        T("Stop", 17.sp, bold = true)
    }
}

@Composable
private fun ColumnScope.OperationPanel(a: ApiData, c: ApiCard, r: ApiRow, close: () -> Unit) {
    val p = LocalPalette.current
    val open = remember(r.op) { mutableStateMapOf("Request" to true, "Returns" to true) }
    Head(listOfNotNull(r.method, r.path ?: r.field).joinToString(" "), "${c.name} · ${if (c.kind == "rest") "REST" else "GraphQL"}", close)
    Column(Modifier.weight(1f).padding(top = 8.dp).verticalScroll(rememberScrollState())) {
        r.about?.let { T(it, 17.sp, modifier = Modifier.padding(bottom = 12.dp)) }
        val callers = a.callers.filter { c.part in it.to }.map { it.name } +
            a.resolves.filter { it.second == r.op }.mapNotNull { (from, _) -> a.cards.flatMap { it.rows }.firstOrNull { it.op == from }?.let { it.field ?: it.path } }
        // "RefundRequest { amount, reason }": the type, then each field on its own line.
        val request = r.request?.let { req -> listOf(req.substringBefore("{").trim()) + req.substringAfter("{", "").substringBefore("}").split(",").map { it.trim() }.filter { it.isNotEmpty() } } ?: emptyList()
        val sections = listOf(
            if (r.field != null) "Returns" to listOfNotNull(r.returns) else "Request" to request,
            "Responses" to r.responses,
            "Called by" to callers,
        )
        for ((label, rows) in sections) {
            val shown = open[label] == true
            Divider()
            Row(Modifier.fillMaxWidth().height(48.dp).button("$label, ${if (shown) "expanded" else "collapsed"}") { open[label] = !shown }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(if (shown) Glyph.Down else Glyph.Chevron, p.ink2, 16.dp); T(label, 15.sp, bold = true)
            }
            if (shown) Column(Modifier.padding(start = 24.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                rows.ifEmpty { listOf("—") }.forEach { T(it, 15.sp, mono = label != "Called by") }
            }
        }
        Divider()
    }
    Box(Modifier.padding(top = 12.dp).fillMaxWidth().background(p.fill, RoundedCornerShape(12.dp)).padding(14.dp)) { T("Circle or write on an operation; it goes to Claude with your other marks.", 15.sp, p.ink2) }
}

/** A step's journey: what the person does, thinks and feels on it, what could go wrong, and where it goes next. */
@Composable
/** `walk`: walking the flow, the ways on are buttons that go there. */
private fun ColumnScope.StepPanel(f: Flow, page: String, close: () -> Unit, walk: ((String) -> Unit)? = null) {
    val p = LocalPalette.current
    val s = f.screens.firstOrNull { it.page == page } ?: return
    val j = f.journey.firstOrNull { it.page == page }
    val out = f.moves.filter { it.from == page }.sortedBy { it.whenIt != null }
    val name = { to: String -> f.screens.firstOrNull { it.page == to }?.name ?: to }
    Head(s.name, if (s.step != null) "Step ${s.step} of ${f.screens.count { it.step != null }} · ${f.name}" else "When things differ · ${f.name}", close)
    Column(Modifier.weight(1f).padding(top = 8.dp).verticalScroll(rememberScrollState())) {
        j?.confidence?.let { c ->
            Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                T("Confidence", 13.sp, p.ink2, bold = true)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { for (i in 1..5) Box(Modifier.size(10.dp).background(if (i <= c) p.accent else p.fill, CircleShape)) }
                T("$c of 5", 13.sp, p.ink2)
            }
        }
        if (j == null || j.cells.isEmpty()) T("No journey for this screen yet. Your agent writes one with set_journey.", 15.sp, p.ink2, modifier = Modifier.padding(vertical = 12.dp))
        for (lane in f.lanes) {
            val cell = j?.cells?.get(lane) ?: continue
            Column(Modifier.padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                T(lane, 13.sp, p.ink2, bold = true)
                T(cell, 15.sp, if (lane == "Risk") p.red else p.ink)
            }
            Divider()
        }
        if (walk == null && out.isNotEmpty()) Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            T("Goes on to", 13.sp, p.ink2, bold = true)
            for (m in out) T(if (m.whenIt != null) "If ${m.whenIt.replaceFirstChar { it.lowercase() }} → ${name(m.to)}" else "${m.label} → ${name(m.to)}", 15.sp, if (m.whenIt != null) p.ink2 else p.ink)
        }
    }
    if (walk == null) Box(Modifier.padding(top = 12.dp).fillMaxWidth().background(p.fill, RoundedCornerShape(12.dp)).padding(14.dp)) {
        T("Write on the screens or between them; it goes to Claude with the flow.", 13.sp, p.ink2)
    } else Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        T("What happens next", 13.sp, p.ink2, bold = true)
        if (out.isEmpty()) T("The end of the flow.", 15.sp, p.ink2)
        for (m in out) {
            val usual = m.whenIt == null
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).background(if (usual) p.accent else p.fill, RoundedCornerShape(12.dp)).clip(RoundedCornerShape(12.dp))
                .button(if (usual) "${m.label}, go to ${name(m.to)}" else "If ${m.whenIt}, go to ${name(m.to)}") { walk(m.to) }.padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(if (usual) Glyph.Chevron else Glyph.Route, if (usual) Color.White else p.ink2, 16.dp)
                T(if (usual) "${m.label} → ${name(m.to)}" else "If ${m.whenIt?.replaceFirstChar { it.lowercase() }} → ${name(m.to)}", if (usual) 15.sp else 14.sp, if (usual) Color.White else p.ink, bold = usual, lines = 2)
            }
        }
    }
}

@Composable
private fun Empty(words: String) {
    val p = LocalPalette.current
    Box(Modifier.fillMaxSize().padding(120.dp), contentAlignment = Alignment.Center) { T(words, 17.sp, p.ink2, align = TextAlign.Center) }
}
