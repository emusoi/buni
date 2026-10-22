package app.emusoi.buni

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * The tablet's tokens (docs/hig-for-buni-tablet.md): light by default, dark when the tablet is. `accent` fills buttons,
 * `accentText` is the accent as text; `teal` is Claude's colour (proposed parts, plans), never pink.
 */
data class Palette(
    val canvas: Color, val surface: Color, val chrome: Color, val ink: Color, val ink2: Color, val ink3: Color,
    val line: Color, val fill: Color, val dot: Color, val accent: Color, val accentText: Color, val accentTint: Color,
    val red: Color, val destructive: Color, val green: Color, val teal: Color, val tealTint: Color, val dark: Boolean,
    /** A weak step in a flow: low confidence, worth a look. */
    val amber: Color,
)

private val Light = Palette(
    canvas = Color(0xFFF2F2F7), surface = Color.White, chrome = Color.White, ink = Color(0xFF1C1C1E), ink2 = Color(0xFF636366),
    ink3 = Color(0xFF6E6E73), line = Color(0x243C3C43), fill = Color(0x1F767680), dot = Color(0x1F3C3C43),
    accent = Color(0xFF0071E3), accentText = Color(0xFF0066CC), accentTint = Color(0x1A0071E3),
    red = Color(0xFFD70015), destructive = Color(0xFFD70015), green = Color(0xFF1D7A34),
    teal = Color(0xFF006B77), tealTint = Color(0x17007C89), dark = false, amber = Color(0xFFB25000),
)
private val Dark = Palette(
    canvas = Color.Black, surface = Color(0xFF1C1C1E), chrome = Color(0xFF2C2C2E), ink = Color.White, ink2 = Color(0xFFAEAEB2),
    ink3 = Color(0xFF98989D), line = Color(0x2EFFFFFF), fill = Color(0x3D767680), dot = Color(0x24FFFFFF),
    accent = Color(0xFF0071E3), accentText = Color(0xFF5EAAFF), accentTint = Color(0x330071E3),
    red = Color(0xFFFF6961), destructive = Color(0xFFC4001B), green = Color(0xFF30D158),
    teal = Color(0xFF5AC8D8), tealTint = Color(0x245AC8D8), dark = true, amber = Color(0xFFFFB340),
)

val LocalPalette = staticCompositionLocalOf { Light }

@Composable
fun BuniTheme(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalPalette provides if (isSystemInDarkTheme()) Dark else Light, content = content)
}

/** "#c8331f" as a colour; ink written as a CSS variable comes out as the theme's ink. */
fun cssColor(s: String, p: Palette): Color = runCatching {
    if (s.startsWith("#") && s.length == 7) Color(0xFF000000 or s.substring(1).toLong(16)) else p.ink
}.getOrDefault(p.ink)

fun hex(c: Color): String = "#%06x".format(((c.red * 255).toInt() shl 16) or ((c.green * 255).toInt() shl 8) or (c.blue * 255).toInt())
