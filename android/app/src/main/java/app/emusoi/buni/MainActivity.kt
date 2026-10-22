package app.emusoi.buni

import android.content.Intent
import android.os.Bundle
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.lifecycle.lifecycleScope

private const val SCALE = 0.8f

/**
 * buni on the tablet. The Mac starts it over the USB cable with `--es url http://localhost:<port>/tablet/v1?code=…`;
 * the app trades the code for a token and draws the design natively. It connects to that localhost and nothing else.
 */
class MainActivity : ComponentActivity() {
    private lateinit var session: Session

    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        // Thinking with a pen takes a while: the tablet shouldn't lock under it.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        session = Session(applicationContext, lifecycleScope)
        session.opened(intent?.getStringExtra("url"))
        setContent {
            // Everything a fifth smaller than Android's own size: the chrome reads lighter around the design, and the
            // 56dp tool buttons still land at the 44dp a finger needs.
            val d = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(d.density * SCALE, d.fontScale)) { BuniTheme { App(session) } }
        }
        hideBars()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        session.opened(intent.getStringExtra("url"))
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideBars()
    }

    /** The whole screen for the design; the system bars come back with a swipe from the edge. */
    private fun hideBars() {
        val c = window.insetsController ?: return
        c.hide(WindowInsets.Type.systemBars())
        c.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
}
