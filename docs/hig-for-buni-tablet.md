# Apple HIG, applied to buni on the tablet

A checkable rulebook for the buni tablet app (Samsung Galaxy Tab S7 FE, landscape
1205×753 dp, Android, native Jetpack Compose, S Pen + fingers). It distils Apple's
Human Interface Guidelines (read October 2026, including the pages updated for Liquid Glass) into rules for this app. HIG points (pt) are treated as dp, and HIG "Apple Pencil" guidance is applied to the S Pen.

How to read it:

- `[page]` names the HIG page a rule comes from (`developer.apple.com/design/human-interface-guidelines/<page>`).
- **Derived** marks a value or rule that HIG does not state. It comes from Apple platform defaults (UIKit/SwiftUI) or from this app's situation, and is labelled so nobody cites it as HIG.
- **Android ⚠** marks a place where Android or Material conventions disagree with HIG, with the call to make. The default is: feel like a great iPad app, but never break an Android system contract (back gesture, system insets, font scale, TalkBack).

Screens and terms used below: **Home** (shows the system), the **view switch** (Context / System / API / Screens), the **canvas** (cards + links, pan/zoom), the **tool rail** (pen, highlighter, eraser, lasso, typed note, colours, undo/redo), **marks** (pen strokes sent to the agent), the **marks drawer**, the **plan panel** (the agent's proposed parts/links: accept, partially accept, discard), the **operation sheet** (one API operation), the **page strip** (pages of a screen design), the **waiting screen** ("waiting for the Mac", USB only), and **toasts**.

---

## 1. Principles that matter most for buni

1. **Content first, chrome floats.** The canvas is the product. Controls sit in a separate floating layer above it. HIG: "Differentiate controls from content." `[layout]`
2. **Elevate content, don't take the person away from it.** The large display exists so the person never leaves the canvas. "minimizing modal interfaces and full-screen transitions" `[designing-for-ipados]`
3. **Pen draws the moment it touches.** No arm/enable step before inking. "Let people make a mark the moment Apple Pencil touches the screen." `[apple-pencil-and-scribble]`
4. **Pen marks, finger navigates, and controls take both.** Every control must respond to the pen too. Otherwise a control "might seem to be unresponsive" `[apple-pencil-and-scribble]`
5. **The pen button only switches modes; it never changes content.** "Avoid using the double-tap gesture to perform an action that modifies content." `[apple-pencil-and-scribble]`
6. **Undo everything, and show what undo did.** Undo lets people "explore and experiment safely". Pan to the restored item if it is off-screen. `[undo-and-redo]`
7. **Use undo instead of confirmation dialogs.** "Avoid displaying alerts for common, undoable actions, even when they're destructive." `[alerts]`
8. **The person stays in charge of the agent.** "Keep people in control." Plans are proposals until accepted, and every accept can be undone. `[generative-ai]`
9. **Say what the AI is doing, specifically.** Instead of "Processing…", give specific messages like "Finding substitutions for ingredients". `[generative-ai]`
10. **Never block while waiting.** "Show something as soon as possible." Let people keep sketching while Claude thinks. `[loading]`, `[generative-ai]`
11. **One prominent action per surface.** "Keep the number of prominent buttons to one or two per view." Accept in the plan panel. `[buttons]`
12. **Not colour alone.** "Avoid relying solely on color to differentiate between objects" `[color]`. Proposed, accepted and removed parts need shape or label cues as well as hue.
13. **Contrast 4.5:1 for text, in both themes.** Text up to 17 pt needs 4.5:1. 18 pt and bold text need 3:1. `[accessibility]`
14. **Hit targets 44+ (48 on Android).** "a button needs a hit region of at least 44x44 pt" `[buttons]`
15. **Motion has a job or it goes.** "Add motion purposefully, supporting the experience without overshadowing it." Respect Reduce Motion. `[motion]`, `[accessibility]`
16. **Custom gestures are shortcuts, never the only way.** A custom gesture must be "Not the only way to perform an important action" `[gestures]`. Two-finger-tap undo needs a visible Undo button too.
17. **Don't fight system gestures.** "Avoid conflicting with gestures that access system UI." On Android this covers the back edge swipe and the home/recents swipe. `[gestures]`
18. **Plain, action-first words.** Verbs on buttons, no "we", say "tap" and not "click". "Provide clear next steps on any blank screens." `[writing]`
19. **Teach by doing, in context.** "Teach through interactivity." Use tips next to the thing they explain, not a slideshow. `[onboarding]`, `[offering-help]`
20. **Follow the system appearance.** "Avoid offering an app-specific appearance setting." buni already follows `isSystemInDarkTheme()`, so keep it that way. `[dark-mode]`

---

## 2. Rules by area

Every rule is written so a reviewer can check it as yes or no against a screen or a build.

### 2.1 Layout & safe areas

- **L1** Draw the canvas full-bleed under all floating chrome (top bar, tool rail, panels). Chrome floats over it and does not push it. "extend it underneath sidebars, toolbars" `[layout]`, `[materials]`
- **L2** Keep every interactive control and essential text inside the system insets (status bar, gesture-nav area, display cutout). In Compose, apply `WindowInsets.safeDrawing` to the chrome only, never to the canvas. `[layout]` (safe areas)
- **L3** Decide layout on available width, not on device or orientation. ≥ 840 dp counts as regular (an Android "expanded" window, iPad "regular"). Below that, collapse side panes into sheets. "Determine layout based on size classes, not device type or orientation." `[layout]`. Android split-screen gives buni ~600 dp, and it must still work there.
- **L4** Keep functionality the same at every width. Only change how much is visible. "Don't change your app's functionality based on the space it occupies." `[layout]`
- **L5** Order content by importance: top and leading edge first. View title and view switch go at the top. The primary action goes on the trailing side. `[layout]`, `[toolbars]`
- **L6** Group with space and containers, not lines everywhere. "use negative space, container shapes, or separator lines" `[layout]`
- **L7** Use progressive disclosure. Card details, plan rationale and operation schemas stay collapsed until asked for. `[layout]`, `[disclosure-controls]`
- **L8** Column plan at 1205 dp landscape (**Derived** from HIG split-view guidance and iPad inspector widths):
  - Tool rail: leading, 64 dp wide, floating with 12 dp inset from the edge.
  - Trailing inspector slot: 340 dp (range 320–380). It holds **one of** the plan panel, operation sheet or marks drawer. With it open the canvas keeps ≥ 840 dp visible.
  - Home sidebar (if Home lists systems): 280–320 dp, leading, hideable. HIG: "Avoid hiding the sidebar by default". `[sidebars]`
  - Never more than three vertical panes at once (rail + canvas + one inspector). HIG allows "either two vertical panes ... or three". `[split-views]`
- **L9** Readable text width: long prose (plan rationale, operation descriptions) wraps at ≤ 672 dp, about 70 characters (**Derived**: UIKit readable-content guide at default size). HIG names "restrict the width of text for optimal readability" as a guide. `[layout]`
- **L10** Margins: 20 dp between screen edge and chrome or content in panels. 16 dp inner padding in panels (**Derived**: UIKit regular-width layout margins).
- **L11** Don't nest same-direction scrolling. Never put a vertically scrolling list inside a vertically scrolling panel. The canvas pans in 2D, so panels on top of it must stop their scroll at their own bounds and must not pass leftover drag to the canvas. "Avoid putting a scroll view inside another scroll view with the same orientation." `[scroll-views]`
- **L12** Handedness: no control may sit only under the drawing hand. Ship a left-handed setting that mirrors the tool rail to the trailing edge (and the inspector to leading). "Design a great left- and right-handed experience." "consider letting people reposition them." `[apple-pencil-and-scribble]`
- **L13** Plan for windowed and multi-window use. Android freeform or split windows are the equivalent of iPad windowing. "Make sure that your windows adapt fluidly to different sizes" `[windows]`, `[multitasking]`

**Android ⚠** Material's navigation rail and FAB patterns don't apply here. Use HIG's model:
a top toolbar plus floating tool palette, with the primary action in the trailing toolbar area (`[toolbars]`). Keep Android's inset handling: edge-to-edge with `enableEdgeToEdge()`, insets applied to chrome.

### 2.2 Typography

- **T1** Default body 17 sp. Never below 11 sp for any chrome text. "iOS, iPadOS | 17 pt |
  11 pt" `[typography]`, `[accessibility]`
- **T2** Use Regular, Medium, Semibold and Bold weights only. "avoid Ultralight, Thin, and Light font weights" `[typography]`
- **T3** Use one typeface family for UI (plus one mono for API paths and types, if needed). "Minimize the number of typefaces you use" `[typography]`
- **T4** Build hierarchy from size, weight and colour (label → secondary → tertiary), and keep it intact when text scales. `[typography]`, `[color]`
- **T5** Chrome text uses `sp`, so it follows Android's font-size setting (the Dynamic Type equivalent). Verify the app at font scale 1.3 and at 2.0 (Android 14 non-linear scaling). "Make sure your app's layout adapts to all font sizes." `[typography]`
- **T6** At large font scales: stack horizontally adjacent items, let rows grow taller, and keep truncation to a minimum. "Keep text truncation to a minimum as font size increases." `[typography]`, `[layout]`
- **T7** Scale what matters. Card titles and plan text scale. Segment labels and tab titles may scale less. "they don't always want to increase the size of every word" `[typography]`
- **T8** **Canvas text is content, not chrome.** It scales with zoom, not with font scale. When a card label would draw below 11 dp on screen, switch to a reduced level of detail (title only, then a shape) rather than drawing illegible text. (**Derived** from T1.)
- **T9** Use loose leading for multi-line prose and tight leading only for 1–2-line rows. "If you need to display three or more lines of text, avoid tight leading" `[typography]`
- **T10** Thin weights need bigger sizes. Any 400-weight text under 13 sp needs a contrast check at 4.5:1 or better. `[typography]`, `[accessibility]`

### 2.3 Color & dark mode

- **C1** Name colours by role (canvas, surface, card, ink, ink2, ink3, line, accent, destructive, proposed, accepted), never by hue, and never reuse a role for something else. "Avoid using the same color to mean different things." `[color]`
- **C2** Don't redefine semantic roles. "don't use the separator color as a text color" Map: `line` is never text, and `ink3` is never a background. `[color]`
- **C3** Every colour has a light and a dark value, and ideally a high-contrast value too. "supply light and dark variants, and an increased contrast option" `[color]`
- **C4** Contrast floors, checked in **both** themes `[accessibility]`, `[dark-mode]`:
  - Text ≤ 17 sp regular: **4.5:1**. Text ≥ 18 sp, or bold at any size: **3:1**.
  - Custom foreground/background pairs: "strive for a contrast ratio of 7:1, especially in small text" `[dark-mode]`
  - Icons and link strokes that carry meaning: 3:1 against the canvas (**Derived**, WCAG non-text contrast).
- **C5** Current palette check (`android/.../Theme.kt`, computed with WCAG 2 formula):

  | pair | ratio | verdict |
  |---|---|---|
  | light `ink2` on `canvas` | 4.88 | ok for text |
  | light `ink3` on `canvas` | **3.83** | fails small text; use for ≥ 18 sp or non-text only |
  | light `ink3` on white | **4.14** | fails small text |
  | light `accent` on white / white on `accent` | 4.50 | at the floor; fine, don't lighten |
  | light `green` on white | **4.38** | fails small text; darken ~5% |
  | white on dark `accent` (#5B8CFF) | **3.16** | fails for button labels < 18 sp; use dark ink on it, or darken the fill |
  | dark `red` on `card` | **3.60** | fails small text; lighten for text use |
  | dark `ink3` on `canvas` | 5.59 | ok |

- **C6** Never encode state by colour alone. Proposed parts get a dashed outline plus a "Proposed" tag. Removals get strike-through plus a minus badge. Accepted parts go back to the normal style. Errors get an icon plus text. "Convey information with more than color alone." `[accessibility]`, `[color]`
- **C7** Use accent sparingly: the selection, the single primary button and the active tool. Don't tint whole toolbars. "Apply color sparingly" "Refrain from adding color to the background of multiple controls." `[color]`
- **C8** Ink colours must stay distinguishable to colour-blind people. Avoid red/green as the only pair, and label colour swatches for TalkBack ("Red", "Blue"). `[accessibility]`
- **C9** Pen ink on the canvas: user ink colours stay **as drawn** across theme switches only when drawn over fixed content (screen-design images). Plain-canvas ink may adapt (black ↔ white). "prevent the dynamic adjustment of colors so that the markup remains sharp" `[apple-pencil-and-scribble]`
- **C10** Dark mode: background layers recede, and foreground layers (sheets, popovers, inspector) use the **elevated**, lighter surface rather than a shadow. `[dark-mode]` (base vs elevated)
- **C11** Follow the system theme. No in-app appearance toggle. `[dark-mode]`
- **C12** Test both themes in bright and dim light. A tablet on a desk by a window is a real case. `[color]`

### 2.4 Materials & depth

- **M1** Two layers only: **content** (canvas, cards, page images) and **controls** (top bar, tool rail, inspector, popovers). Translucent "glass" is allowed only on the controls layer. "Don't use Liquid Glass in the content layer." `[materials]`
- **M2** Use translucency sparingly. If used, only on the top bar and tool rail, so canvas content peeks through. Panels with lots of text (plan panel, operation sheet) are near-opaque. "Use the regular variant ... when components have a significant amount of text" `[materials]`
- **M3** Thicker material wherever text is fine-featured. "Thicker materials ... provide better contrast for text" `[materials]`
- **M4** No custom tinted toolbar backgrounds. "Reduce the use of toolbar backgrounds and tinted controls." `[toolbars]`
- **M5** Honour the Android "Remove animations" and high-contrast text settings, and provide an opaque fallback: when transparency would hurt legibility, use solid `surface`. (Apple: Reduce Transparency, Increase Contrast.) `[materials]`, `[dark-mode]`
- **M6** Corner radii of nested shapes are **concentric**: inner radius = outer radius − padding. "ensure that its corner radius is also concentric with the bar's corners." `[toolbars]`

**Android ⚠** Compose has no system Liquid Glass. Don't fake heavy refraction or blur on
Android 12-, where `RenderEffect` blur is unavailable or costly. A solid `surface` at 92–96% opacity plus a 1 dp hairline gets the HIG intent: controls clearly separated from content.

### 2.5 Icons (SF Symbols-style)

- **I1** One icon family, one stroke weight, one perspective, one detail level across the app. "use a consistent size, level of detail, stroke thickness (or weight), and perspective" `[icons]`
- **I2** Match icon weight to adjacent text weight. `[icons]`, `[sf-symbols]`
- **I3** Use outline icons in toolbars and lists. Filled icons mark the selected tool or state. "fill variant ... places where you use an accent color to communicate selection" `[sf-symbols]`
- **I4** Use standard metaphors: undo `arrow.uturn.backward`, redo `arrow.uturn.forward`, delete `trash`, more `ellipsis`, add `plus`, close `xmark`, done `checkmark`, filter `line.3.horizontal.decrease`, share `square.and.arrow.up`. `[icons]` (standard icons)
- **I5** Optically centre asymmetric icons (pen, highlighter nib, eraser). `[icons]`
- **I6** Every icon-only control has a TalkBack `contentDescription`. "Provide alternative text labels for custom interface icons." `[icons]`
- **I7** Icon plus label where meaning isn't instant. The view switch uses text, and the tool rail uses icons with a long-press or hover label. "Consider using text when a short label communicates more clearly than an icon." `[buttons]`
- **I8** Icons scale with font scale when they carry meaning. "Increase the size of meaningful interface icons as font size increases." `[typography]`
- **I9** Vector only (ImageVector/SVG). `[icons]`
- **I10** No borders or circles around toolbar icons; the bar is the container. "Prefer system-provided symbols without borders." `[toolbars]`

### 2.6 Motion

- **Mo1** Every animation answers "what changed, where did it go?" Otherwise remove it. `[motion]`
- **Mo2** Motion follows the finger or pen. Pan and zoom track the gesture 1:1 with momentum, and dismissals go the way they came in. "if someone reveals a view by sliding it down ... they don't expect to dismiss the view by sliding it to the side." `[motion]`
- **Mo3** No decorative motion on frequent actions: tool switches, stroke commits and selection changes are instant or under 120 ms. "avoid adding motion to UI interactions that occur frequently." `[motion]`
- **Mo4** Animations are interruptible. A new gesture cancels an in-flight zoom or panel slide immediately. "Let people cancel motion." `[motion]`
- **Mo5** Never put motion or feedback only in animation. Pair it with text or state. "Make motion optional." `[motion]`
- **Mo6** Reduce motion: when the system "Remove animations" setting is on (`Settings.Global.ANIMATOR_DURATION_SCALE == 0`) or the in-app equivalent: replace slides and zooms with fades, tighten springs to no bounce, no animated blur, no z-depth animation. Programmatic camera moves (e.g. "show what undo did") jump-cut with a short highlight. `[accessibility]` (cognitive)
- **Mo7** Panel size changes animate in place, so a popover or panel that grows doesn't look replaced. "animate the change to avoid giving the impression that a new popover replaced the old one." `[popovers]`
- **Mo8** No fast blinking. Status pulses are slow (≥ 1 s period), low amplitude, and stop when done. `[accessibility]`

### 2.7 Haptics & feedback

- **H1** Use haptics rarely, only for discrete physical moments: a card snapping into a frame, lasso grab, a drop accepted. Never for every stroke. "Avoid overusing haptics." "prefer playing short haptics that complement discrete events." `[playing-haptics]`
- **H2** One haptic per meaning, used consistently. Don't reuse the "success" pattern for "snap". `[playing-haptics]`
- **H3** Haptics are optional and never the only signal. "Make haptics optional." `[playing-haptics]`
- **H4** Match feedback weight to importance. Status is passive and inline. Possible data loss interrupts. `[feedback]`
- **H5** Put status near the thing it describes. The agent status lives in the plan panel header or by the Send button, not in a global spinner. "Consider integrating status feedback into your interface." `[feedback]`
- **H6** Confirm only significant completions. Don't celebrate routine success. People "only need to know when it doesn't" succeed. `[feedback]`
- **H7** When something can't be done, say why and what to do next. `[feedback]`

**Android ⚠** iPads have no haptic engine, so a great iPad app is silent here. On the Tab
S7 FE, use `View.performHapticFeedback(HapticFeedbackConstants.CONFIRM / SEGMENT_TICK)` only for H1 moments. Leave the system "Touch feedback" setting in charge (no `FLAG_IGNORE_GLOBAL_SETTING`).

### 2.8 Buttons & controls

- **B1** Hit region ≥ 44×44 pt per HIG. **On Android use ≥ 48×48 dp** (Material/Android accessibility). The visible shape can be smaller (≥ 28 dp) if the touch area is padded out. `[buttons]`, `[accessibility]`
- **B2** Spacing between targets: about 12 dp around bezeled controls, about 24 dp around borderless ones. "add about 12 points of padding around elements that include a bezel" `[accessibility]`
- **B3** Every custom control has a visible pressed state (pen and finger). "Always include a press state for a custom button." `[buttons]`
- **B4** One or two prominent (filled accent) buttons per view, ideally one. "Keep the number of prominent buttons to one or two per view." `[buttons]`
- **B5** Use style, not size, to show the preferred option. Accept and Discard are the same size, and Accept is filled. `[buttons]`
- **B6** Destructive actions use the destructive role (red) and are **never** the primary or default button. "Don't assign the primary role to a button that performs a destructive action" `[buttons]`
- **B7** Labels start with a verb: "Accept plan", "Send marks", "Discard". `[buttons]`, `[writing]`
- **B8** Buttons that start slow work show an inline spinner and a progressive label ("Send" → "Sending…"). Don't hide the button. "Checkout" could change to "Checking out…" `[buttons]`
- **B9** Unavailable controls look clearly unavailable and say why on tap. "the button's unavailable state may not be clearly distinct" (named as a bug) `[gestures]`
- **B10** Toggles: a switch only inside a list row (settings). Elsewhere use a toggle-button (selected style). "Use the switch toggle style only in a list row." `[toggles]`
- **B11** Colour choice uses a small fixed swatch set in the rail. A full picker only behind "More colours", as a popover. `[color-wells]`, `[color]`
- **B12** Sliders (stroke width, opacity) are horizontal, with min/max shown, plus a live preview stroke. `[sliders]`, `[apple-pencil-and-scribble]` (hover preview)

### 2.9 Toolbars (top bar)

- **Tb1** Three groups at most: **leading** (Back to Home, view title), **centre** (view switch), **trailing** (marks drawer toggle, inspector toggles, overflow, primary action). "aim for a maximum of three" `[toolbars]`
- **Tb2** Only one primary action, filled, at the trailing end (e.g. "Send to Claude" when marks exist). "Only specify one primary action, and put it on the trailing side" `[toolbars]`
- **Tb3** Titles are useful and short, under 15 characters ideally. Never the app name. "Don't title windows with your app name." `[toolbars]`
- **Tb4** The Back button uses the standard chevron, with no "Back" text. "don't use a text label that says Back or Close." `[toolbars]`
- **Tb5** Keep text-labelled buttons separated from icon buttons with fixed space, so they don't read as one control. `[toolbars]`
- **Tb6** No layout where items overflow by default at 1205 dp. Define what collapses into ⋯ first at narrow widths. `[toolbars]`
- **Tb7** Leading-edge items (Back, sidebar toggle) never move or get hidden. `[toolbars]`
- **Tb8** The tool rail is a toolbar too: group drawing tools / colours / undo-redo with dividers, ≤ 3 groups, no borders around icons. `[toolbars]`, `[apple-pencil-and-scribble]`

### 2.10 Segmented control (the view switch)

- **S1** Context / System / API / Screens are four views of the **same system**, so a segmented control is right: "closely related choices that affect an object, state, or view" `[segmented-controls]`. A tab bar would be for unrelated app sections. `[tab-bars]`
- **S2** ≤ 5–7 segments on a wide screen (buni has 4). "no more than about five to seven segments in a wide interface" `[segmented-controls]`
- **S3** Equal-width segments. "keep segment size consistent" `[segmented-controls]`
- **S4** Text **or** icons, not mixed. Use text here. "Prefer using either text or images — not a mix of both" `[segmented-controls]`
- **S5** Labels are nouns: "Context", "System", "API", "Screens". "Use nouns or noun phrases for segment labels." `[segmented-controls]`
- **S6** It shows selection only. No action segments mixed in. "Don't assign actions to segments in a control that otherwise represents selection state" `[segmented-controls]`
- **S7** Every segment stays enabled even when its view is empty. The empty view explains itself (see 2.15). "Don't disable or hide tab bar buttons, even when their content is unavailable." `[tab-bars]`
- **S8** Each view keeps its own camera (pan/zoom) and selection when you switch away and back. Tab bars "let people quickly switch ... while preserving the current navigation state" `[tab-bars]`

### 2.11 Sidebars, drawers, panels, inspectors

- **P1** Map buni's surfaces to HIG roles:
  - Home's system list is a **sidebar** (navigation, leading, ≤ 2 levels). `[sidebars]`
  - The plan panel, operation sheet and marks drawer are **inspectors**: non-modal, tied to the current view or selection, on the trailing side. `[panels]`, `[split-views]`, `[sheets]` (iPadOS non-modal sheet)
- **P2** One inspector at a time in the trailing slot. Opening another replaces it, with no stacking. (**Derived** from "Display only one sheet at a time" `[sheets]` and "Show one popover at a time" `[popovers]`.)
- **P3** Inspectors are non-modal: the canvas stays live (pen, pan, zoom) while one is open. "Use a nonmodal view when you want to present supplementary items" `[sheets]`
- **P4** Inspectors follow the selection. Selecting another operation updates the operation sheet in place rather than opening a second one. "An inspector ... automatically updat[es] its contents when ... people select a new item." `[panels]`
- **P5** Persistently highlight what the inspector is about on the canvas (selected card or operation outlined). "persistently highlight the current selection in each pane" `[split-views]`
- **P6** Inspector titles are nouns: "Plan", "Marks", "GET /orders". `[panels]`
- **P7** Inspectors favour direct controls (toggles, steppers, segmented) over typing. "Prefer simple adjustment controls in a panel." `[panels]`
- **P8** Closing an inspector never loses work. Partial plan selections and marks persist. "Always save work when automatically closing a nonmodal popover." `[popovers]`
- **P9** Sidebars hide with the standard gesture plus a toolbar button. Don't hide them by default. `[sidebars]`
- **P10** Drag between panes where it makes sense: drag a mark from the drawer onto a card, or a proposed part from the plan onto the canvas. `[split-views]`, `[drag-and-drop]`

### 2.12 Sheets, popovers, alerts — when to use each

| need | use | HIG |
|---|---|---|
| Small choice tied to a control (stroke width, colour, view options, card menu) | **Popover** anchored to the control | `[popovers]` |
| Supplementary, keep-working content (plan, operation, marks) | **Non-modal inspector** (2.11) | `[sheets]`, `[panels]` |
| Scoped task with a start and end (rename system, connect settings) | **Modal sheet**, centred form-sheet size, title + Cancel (leading) / Done (trailing) | `[sheets]` |
| Choices about an action the person just started ("Discard 3 proposed parts?" with Keep/Discard/Accept some) | **Action sheet / confirmation dialog** | `[action-sheets]` |
| Critical, unexpected, irreversible, actionable | **Alert**, ≤ 3 buttons | `[alerts]` |
| Undoable result ("Plan applied · Undo") | **Inline status or toast with Undo** (2.16), never an alert | `[alerts]`, `[feedback]` |

- **Sh1** One modal at a time. Never a sheet on a sheet, or a popover from a popover. "Never show a cascade or hierarchy of popovers" `[popovers]`, `[modality]`
- **Sh2** Every modal has an obvious dismissal: Cancel or close in its top bar **and** system back **and** tap-outside for popovers. "Always give people an obvious way to dismiss a modal view." `[modality]`
- **Sh3** Done is always paired with Cancel (or Back). Never show all three. `[sheets]`
- **Sh4** Swipe-down or back on a sheet with unsaved input asks via an action sheet (Save / Discard / Keep editing). `[sheets]`, `[modality]`
- **Sh5** Popovers point at their source, don't cover it, are only as big as their content, and never carry warnings. "Avoid using a popover to show a warning." `[popovers]`
- **Sh6** Tapping another toolbar button while a popover is open closes it and opens the new one in a single tap. `[popovers]`
- **Sh7** **Destructive confirmation policy** (HIG `[alerts]`, `[feedback]`):
  - Undoable destructive actions (erase strokes, delete card, discard a plan, reject parts) get **no confirmation**. Undo covers them. "Avoid displaying alerts for common, undoable actions, even when they're destructive."
  - Confirm only data loss that is "unexpected and irreversible" `[feedback]`. In buni: clearing all marks across views when not undoable, disconnecting with unsent marks if they would be lost, or an agent plan that **deletes** existing parts (see 2.20).
  - In an alert, the destructive button is styled destructive only when the person didn't pick that action deliberately. A deliberate "Clear all" button's confirm is plain. "Use the destructive style ... people didn't deliberately choose." `[alerts]`
  - Always include "Cancel", never as default. Button titles name the action ("Clear marks"), never "OK"/"Yes". `[alerts]`
- **Sh8** Alert titles say what happened and why, in ≤ 2 lines. Never just "Error". `[alerts]`
- **Sh9** Never alert at launch (see the waiting screen, 2.15). "Avoid showing an alert when your app starts." `[alerts]`

**Android ⚠** Material's `AlertDialog` puts the confirm button trailing, the same as HIG,
so keep that. Material's full-width bottom sheets are a phone pattern. On this tablet, use centred sheets or trailing inspectors (HIG "Prefer using the page or form sheet presentation styles in an iPadOS app" `[sheets]`).

### 2.13 Undo and redo

- **U1** Unlimited undo for the session (since opening the system or the last "logical step"). "Avoid placing unnecessary limits on the number of times people can undo" `[undo-and-redo]`
- **U2** Everything is undoable: strokes, erases, lasso moves, typed notes, colour changes, card moves, **plan accepts (whole or partial)**, plan discards, sends of marks (un-send = restore marks locally). `[undo-and-redo]`, `[generative-ai]`
- **U3** Show what undo or redo did. If the affected item is off-screen or on another view, pan (and switch view) to it and flash a highlight for ≈ 600 ms. "Show the results of an undo or redo." `[undo-and-redo]`
- **U4** Predict it. The undo button's long-press or hover label and TalkBack label name the action: "Undo Erase", "Undo Accept plan", "Redo Move card". "Briefly and precisely describe the operation" `[undo-and-redo]`
- **U5** Batch related micro-steps. One continuous stroke is one undo. A slider drag is one undo. Accepting a plan with 7 parts is one undo. "Consider giving people the option to revert multiple changes at once." `[undo-and-redo]`
- **U6** Visible undo/redo buttons on the tool rail, using the standard symbols. HIG says the tool picker in regular width "includes undo and redo buttons" `[apple-pencil-and-scribble]`.
- **U7** Gestures (supplements to U6):
  - HIG standard: **three-finger swipe left = undo, right = redo**. "Avoid redefining standard gestures for undo and redo." `[undo-and-redo]`, `[gestures]`
  - HIG does **not** mention two-finger-tap undo. It is a drawing-app convention (Procreate, Notability, etc.: two-finger tap = undo, three-finger tap = redo). HIG allows custom gestures "like in a game or drawing app" if they are discoverable, easy, distinct, and not the only way `[gestures]`. **Recommendation:** support two-finger tap = undo and three-finger tap = redo on the canvas. Also support three-finger swipe. Teach both once (2.15). Show the same "Undo X" feedback as the button.
  - A two-finger tap must not fire when the fingers moved (that's a pan or pinch): tap means both fingers lift within ~250 ms with < 10 dp travel (**Derived**).
  - Hardware keyboard: Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y). `[keyboards]`
- **U8** No shake-to-undo on a tablet: unergonomic, and HIG frames it as iPhone. `[undo-and-redo]`
- **U9** Drag and drop is undoable. "Prefer letting people undo a drag-and-drop operation." `[drag-and-drop]`

**Android ⚠** Check that Samsung One UI multi-finger gestures (e.g. palm swipe to capture)
don't collide with three-finger swipe. If they do, keep the two-finger/three-finger taps and the buttons, and drop the swipe.

### 2.14 Loading & progress

- **Lo1** Show something at once. Views render from the cached model immediately and refresh in place. Use placeholder (skeleton) cards only for content never seen before. "Show something as soon as possible." `[loading]`
- **Lo2** Never block input while loading or while the agent works. The canvas, pen and views stay usable. "Let people do other things in your app ... while they wait" `[loading]`
- **Lo3** Prefer determinate progress (e.g. "Reading 12 marks · 3 of 4 views"). Use indeterminate only when unknown. Keep it moving, and if it stalls, say so. "When possible, use a determinate progress indicator." `[progress-indicators]`
- **Lo4** Status text is specific, never "Loading…". "Avoid vague terms like loading or authenticating" `[progress-indicators]`, `[generative-ai]`
- **Lo5** Agent work can be cancelled (a "Stop" button beside the status). "When it's feasible, let people halt processing." `[progress-indicators]`
- **Lo6** Progress lives in one consistent place (plan panel header, and a small status pill in the top bar when the panel is closed). "Display a progress indicator in a consistent location." `[progress-indicators]`
- **Lo7** Never switch a spinner into a bar or back. "Don't switch from the circular style to the bar style." `[progress-indicators]`
- **Lo8** Launch: the first frame looks like the app's first screen (same background), with no logo splash and no text on the launch screen. Restore the last view, camera and open inspector on relaunch. "Restore the previous state when your app restarts" `[launching]`
- **Lo9** Keep data fresh automatically (Mac pushes model changes). There is no pull-to-refresh on a canvas. "Don't make people responsible for initiating every update." `[progress-indicators]`

### 2.15 Empty states, onboarding, help

- **E1** Every empty view (no API yet, no screens, no marks) says what it is for and offers the next step as a button. "Provide clear next steps on any blank screens." `[writing]`
- **E2** Empty states are temporary, so don't put crucial information only there. `[writing]`
- **E3** No up-front tutorial carousel. Teach the pen in place: the first time the canvas opens, invite a mark ("Circle something and add a note — Claude will answer with a plan"). The real first stroke completes the lesson. "Teach through interactivity." `[onboarding]`
- **E4** Context tips, one at a time, near the control they explain, each ≤ 2 sentences, each for a feature of ≤ 3 steps, shown no more than about once a day, and never again once used. Candidates: S Pen button = eraser; two-finger tap = undo; long-press a card = menu; lasso to group marks. `[offering-help]`
- **E5** Any skipped intro must be findable later (Help item in the overflow menu). `[onboarding]`
- **E6** Don't explain standard things (pinch to zoom, back). Do explain buni-specific ones (marks go to Claude, plans are proposals). `[offering-help]`
- **E7** Postpone setup. The app works with defaults; no settings wizard. `[onboarding]`, `[settings]`
- **E8** **Waiting screen** (no Mac): treat it as a state, not an error alert.
  - If a previous model is cached, show Home/canvas read-only with a non-intrusive banner ("Not connected to your Mac — changes will sync when you plug in"). "show cached or placeholder data and a nonintrusive label" `[alerts]`
  - If nothing is cached, give a calm full-screen state with a numbered next step ("Connect the USB cable to your Mac, then run `buni open`"), live status that updates by itself, and no Retry button needed if detection is automatic.
  - Allow sketching while disconnected if marks can queue. Say they will send on connect.
  - No blame, no "Oops". `[writing]`

### 2.16 Feedback, errors, toasts

- **F1** Errors appear next to their cause (a failed operation in the operation sheet, a failed send by the Send button), say what to do, and don't blame. "display it as close to the problem as possible, avoid blame" `[writing]`
- **F2** Toasts/banners are for undoable, non-critical outcomes ("Plan applied · 5 parts · Undo"). Never for warnings that need a decision (use an alert or action sheet) and never the only record of something important. `[feedback]`, `[alerts]`
- **F3** Toast placement: bottom-centre of the canvas, above the gesture area, clear of the tool rail and the drawing hand. At most one at a time; a new one replaces the old. (**Derived**)
- **F4** Timeboxing: HIG says "Minimize use of time-boxed interface elements." `[accessibility]` Toasts with an action (Undo) stay ≥ 8 s, pause while touched, and are announced to TalkBack (`LiveRegion.Polite`). Undo also stays available from the rail after the toast goes, so nothing depends on catching it.
- **F5** Persistent states (disconnected, agent failed) are banners that stay until resolved, not toasts.
- **F6** Gesture not available? Say so. A locked or read-only canvas (disconnected) gives a visible reason when someone tries to drag. "Indicate when a gesture isn't available." `[gestures]`

**Android ⚠** Material `Snackbar` defaults (4 s, short) conflict with F4. Use
`SnackbarDuration.Long` or `Indefinite` with an action, or a custom banner.

### 2.17 Writing

- **W1** Use one capitalization style per element type, applied everywhere. HIG lets you choose ("Choose a style for each UI element type and use it consistently" `[writing]`). Apple's own default is title case for buttons and menus. **Recommendation for buni: sentence case everywhere** (buttons, menus, titles). It matches Android and buni's web editor, and HIG accepts it as long as it is consistent. Tooltips are sentence case either way `[offering-help]`.
- **W2** Button and menu labels start with a verb ("Accept plan", "Send marks", "Clear page"). Segment and inspector titles are nouns. `[writing]`, `[segmented-controls]`, `[panels]`
- **W3** Be specific instead of cute. "“Send” often works better than “Let's do it!”" `[writing]`
- **W4** No "we". "Avoid using we altogether" `[writing]` Use "Couldn't reach your Mac", not "We're having trouble…". (Claude may speak as itself inside its plan text, labelled as Claude.)
- **W5** Device-correct verbs: "tap", "draw", "press the pen button"; never "click". `[writing]`, `[offering-help]`
- **W6** Few possessives. Use "Marks", not "Your marks". `[writing]`
- **W7** Keep a glossary and use it everywhere: *part, link, mark, plan, view, operation, page*. Don't say card in one place and node or box in another. "Create a list of common terms" `[writing]`
- **W8** Ellipsis only on commands that need more input before acting ("Rename…"). `[menus]`
- **W9** Menu items drop articles and stay short. `[menus]`
- **W10** Tooltips and hover labels are ≤ 60–75 characters, describe the control's action, and don't repeat its name. `[offering-help]`

### 2.18 Accessibility

- **A1** Every control and every card or link has a TalkBack label. Cards read "Part, Orders service, 3 links". Links read "Link, Web app to Orders service, HTTPS". Proposed parts read "Proposed by Claude". `[accessibility]`, `[icons]`
- **A2** Focus order follows reading order: top bar → view switch → tool rail → canvas → inspector. Opening an inspector moves focus to its title, and closing returns focus to the control that opened it. (**Derived**, HIG layout reading order `[layout]`.)
- **A3** The canvas is navigable without gestures: parts and links are traversable in a logical order (list order in an accessibility tree, or a "List view" of the canvas). "Offer alternatives to gestures." `[accessibility]`
- **A4** Hit targets per B1, spacing per B2.
- **A5** Contrast per C4/C5, in both themes.
- **A6** Not colour-only (C6).
- **A7** Reduced motion per Mo6.
- **A8** No timeouts that can't be extended (F4).
- **A9** Every gesture has a button: undo/redo buttons, zoom buttons (+/− and "Fit"), context menu content also available in the inspector or an overflow menu. "Always make context menu items available in the main interface, too." `[context-menus]`, `[accessibility]`
- **A10** Keyboard and Switch Access work: Tab or arrows move between parts, Enter opens, Delete removes (undoable), Esc closes popovers and sheets. `[accessibility]`, `[keyboards]`
- **A11** Use simple gestures for frequent actions. Two-finger tap is fine. Avoid long multi-finger sequences. "avoid custom multifinger and multihand gestures" for frequent interactions `[accessibility]`. That argues for keeping the undo **button** as the primary undo path.

### 2.19 S Pen (Apple Pencil guidance mapped)

- **Pen1** Inking starts on pen-down in any drawing tool. No "enter draw mode" button. A pen touch on an empty area of the canvas draws with the current tool. "avoid requiring people to tap a button or enter a special mode" `[apple-pencil-and-scribble]`
- **Pen2** Fingers never ink. With a stylus present, one finger pans, two fingers pinch-zoom/rotate, and taps select. The pen draws and also taps controls. Palm rejection: ignore `TOOL_TYPE_FINGER` contacts with large touch major/size while a stylus is in proximity or down (**Derived**; HIG wants to "Let people choose when to switch between Apple Pencil and finger input" `[apple-pencil-and-scribble]`).
- **Pen3** All controls respond to the pen (`TOOL_TYPE_STYLUS` taps hit buttons, sliders, segmented). Test every control with the pen. `[apple-pencil-and-scribble]`
- **Pen4** Latency: draw the in-progress stroke straight from `MotionEvent` historical points, front-buffered (`androidx.graphics` `GLFrontBufferedRenderer` / low-latency ink, or `androidx.ink`) with motion prediction (`androidx.input` `MotionEventPredictor`). Commit the stroke to the model on pen-up. Target < 25 ms pen-to-ink (**Derived**). HIG: "Make sure Apple Pencil appears to directly and immediately manipulate content" `[apple-pencil-and-scribble]`
- **Pen5** Use pressure for continuous properties only (width, or opacity for the highlighter), never for discrete actions. "it feels natural to affect continuous properties ... by varying the pressure." `[apple-pencil-and-scribble]`. The S7 FE pen reports pressure. Tilt and azimuth are optional.
- **Pen6** Hover preview: when the pen hovers (`ACTION_HOVER_MOVE`, S7 FE supports it), show a cursor with the current tool's size and colour (eraser: its circle; lasso: a crosshair). The preview is mid-range in size or opacity and does **not** change with hover height. "Use hover to help people predict what will happen" "avoid continuously modifying the preview" `[apple-pencil-and-scribble]`
- **Pen7** Hover never triggers an action (no hover-to-open menus, no hover-to-select). "Avoid using hover to initiate an action." `[apple-pencil-and-scribble]`
- **Pen8** Hover preview is pen-only, not mouse. "Prefer showing hover previews for Apple Pencil, not for a pointing device." `[apple-pencil-and-scribble]`
- **Pen9** **S Pen side button = Apple Pencil double tap / squeeze**, so it only switches modes:
  - Press and hold the button while drawing = temporary eraser. Release returns to the tool. This is the Samsung Notes convention and maps to Apple's default "toggle between the current tool and the eraser".
  - Click the button while hovering (not touching) = toggle between the current and previous tool. Optionally open a small tool/size palette **at the pen tip** ("display it close to Apple Pencil Pro" `[apple-pencil-and-scribble]`, squeeze).
  - Never: send marks, accept plans, delete, clear. "avoid using double tap to perform a potentially destructive action" `[apple-pencil-and-scribble]`
  - If you offer custom button behaviours, put them in a setting, off by default, and show the current mode. `[apple-pencil-and-scribble]`
- **Pen10** Eraser behaviours: offer **stroke eraser** (removes whole strokes, the default for marks, which are discrete) and optionally a **pixel/partial eraser** (splits strokes). Show which in the eraser's hover cursor. Every erase is undoable as one step per pen-down/pen-up. (**Derived**; HIG `[apple-pencil-and-scribble]` "Support behaviors people intuitively expect when using a marking instrument".)
- **Pen11** The S Pen's own eraser end (where supported, `TOOL_TYPE_ERASER`) erases without a tool switch.
- **Pen12** Write anywhere text is expected. Typed notes accept handwriting (Android 14+ stylus handwriting in Compose `BasicTextField`, or Samsung's "S Pen to text"). Don't require tapping the field first. Hide the placeholder at first stroke. Don't move, resize or autoscroll the field while writing. No autocomplete overlay while writing. Give writing room (≥ 2 lines tall, ≥ 320 dp wide). `[apple-pencil-and-scribble]` (Scribble)
- **Pen13** Write in the margins: a pen stroke on a card's surface or in open canvas space is a mark, never a drag of the card. Moving cards uses finger drag or the lasso. (**Derived** from "people often want to write in the margins" `[apple-pencil-and-scribble]`.)
- **Pen14** Tool palette conventions: the current tool is clearly selected (filled icon plus accent). Size and colour show on the tool icon itself. A second tap on the selected tool opens its options popover (size, opacity, eraser type). Undo/redo live in the palette. `[apple-pencil-and-scribble]` (PencilKit tool picker), `[toolbars]`
- **Pen15** No continuous haptics on the pen. `[playing-haptics]`

**Android ⚠** The Tab S7 FE's S Pen has no Bluetooth Air Actions, so don't design for remote
button gestures. Button state arrives as `MotionEvent.BUTTON_STYLUS_PRIMARY` on hover and touch events only.

### 2.20 Gestures

- **G1** Standard meanings only `[gestures]`:
  - tap selects or activates
  - finger drag on empty canvas pans, finger drag on a card moves it
  - pinch zooms, and two-finger rotate is optional (probably off for diagrams)
  - long-press opens a context menu
  - double-tap zooms to the item or fits, and double-tap again zooms back
- **G2** Never give a familiar gesture an unfamiliar job. Tap never sends, and swipe never deletes without an undo. `[gestures]`
- **G3** Respond live: pinch scales under the fingers, and pan has momentum. Show the drag ghost after ~3 dp of movement. "Display a drag image as soon as people drag a selection about three points." `[drag-and-drop]`, `[gestures]`
- **G4** Zoom limits are set and shown. "Fit" is always one tap away. "If you support zoom, set appropriate maximum and minimum scale values." `[scroll-views]`
- **G5** Custom gestures (two- and three-finger taps, lasso) are discoverable through a tip, easy, distinct, and duplicated by buttons. `[gestures]`
- **G6** **System edges belong to the system.** Android's back gesture (left and right edge swipe) and home/recents (bottom swipe) must keep working. `[gestures]` ("Avoid conflicting with gestures that access system UI")
  - Don't start canvas pans or tool-rail drags in the outer ~24 dp of the left and right edges. Inset the floating rail ≥ 12 dp, which makes its touch area start past the gesture zone.
  - Use `Modifier.systemGestureExclusion` only on small, specific controls (e.g. a vertical size slider in the rail). Android caps exclusion at 200 dp per edge.
  - Pen strokes that start at the very edge: test them on device. If the back gesture steals S Pen strokes, accept it. Don't exclude the whole edge.
- **G7** Back (gesture, button or Esc) closes the topmost transient first, then navigates: popover → modal sheet → inspector → selection/lasso → (canvas view) back to Home → exit. Support predictive back animations for sheets and inspectors. **Android ⚠** HIG has no system back, but it does say shortcut gestures supplement a visible Back button `[gestures]`. Do both.
- **G8** Context menus `[context-menus]`:
  - Long-press a card for a short, relevant menu, with ≤ 1 submenu level.
  - Hide unavailable items rather than dimming them.
  - Mark destructive items red.
  - Long-press on empty canvas offers "New part / New note" ("consider using a context menu to let people create a new object").
  - Every item is also reachable elsewhere.
  - An item has either a context menu or an edit menu, not both.
- **G9** Multi-select: lasso for the pen, and long-press then tap more for fingers. A selected group moves and deletes as one undo step. `[pointing-devices]` ("Allow multiple selection in custom views")

### 2.21 Canvas apps & going full screen

- **Fs1** Offer a focus mode that hides the top bar and inspector, leaving only a slim tool rail. A single obvious tap or button brings chrome back. "let people restore the hidden elements with a familiar gesture or action" `[going-full-screen]`
- **Fs2** Essential controls stay reachable in focus mode (undo, tool switch, exit focus). `[going-full-screen]`
- **Fs3** Don't exit focus mode automatically. "Let people choose when to exit full-screen mode." `[going-full-screen]`
- **Fs4** Android immersive mode (hiding system bars) is opt-in only, through focus mode, using `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`. One swipe reveals the bars and a second exits. "you can enable two swipes rather than one to exit" `[going-full-screen]`
- **Fs5** When resuming after the app was backgrounded, restore view, camera, tool and selection. `[going-full-screen]`, `[launching]`
- **Fs6** Don't stretch or rescale the canvas content when chrome hides. Only reveal more of it. "don't programmatically resize your window." `[going-full-screen]`

### 2.22 Generative AI / the agent (Claude)

HIG has a dedicated Generative AI page (updated June 2026). Rules for marks → Claude → plan:

- **AI1** **Label AI clearly.** Plans are visibly from Claude (name plus an icon in the plan panel header, and "Proposed by Claude" on ghost parts). "Clearly identify when and where you use AI." `[generative-ai]`
- **AI2** **Show what will change before it changes.** Proposed parts and links render on the canvas as ghosts (dashed outline, "Proposed" tag, + badge). Proposed removals render as strike-through or − badge **on the existing part**. Changes to an existing part show as a before/after diff in the plan panel. Nothing enters the model until accepted. "Keep people in control." `[generative-ai]`
- **AI3** **Accept, partially accept, discard, all easy.**
  - Per-item checkboxes in the plan panel, mirrored by tapping ghosts on the canvas.
  - Accept (filled, primary) applies the checked items. Discard (plain) drops the plan.
  - Both are one undo step (U5).
  - "Give them the ability to dismiss new content they don't want" "revert or retry" `[generative-ai]`
- **AI4** **Confirm significant or irreversible agent actions.** Plans that only add parts don't need confirmation, because Accept is the confirmation and undo covers it. Plans that
  **remove or rename** existing parts default those items to **unchecked** and need explicit selection. "get permission before performing irreversible or potentially problematic tasks" `[generative-ai]`
- **AI5** **Refine, retry, alternatives.**
  - Plan-panel actions: "Retry", plus "Adjust", which reopens the marks with the plan as context.
  - When Claude offers alternatives, show them as a 2–3 option segmented choice in the panel. "Consider offering alternate versions of results." `[generative-ai]`, `[machine-learning]`
  - List the most likely option first.
- **AI6** **Specific progress.** Show what is happening, for example "Reading 6 marks on the System view" → "Drafting 3 parts and 4 links". Never just "Thinking…". "Messages that describe what's actually happening can be more helpful" `[generative-ai]`
- **AI7** **Generate in the background.** The person keeps sketching or switching views while the plan is drafted. The plan arrives as a non-modal panel and never steals focus or moves the camera. "generate in the background while a person uses another part of the app" `[generative-ai]`
- **AI8** **Acknowledge corrections.** After partial accept or an edit to a proposed part, give a brief visible confirmation ("3 of 5 parts added"). "provide a clear signal that their action had an effect" `[generative-ai]`
- **AI9** **Honest failure.** When Claude can't produce a plan, say what happened in plain language with a next step ("Claude couldn't match these marks to a part. Try circling the part you mean."). Keep the marks. `[generative-ai]`, `[writing]`
- **AI10** **Attribution.** Each proposed item links back to the mark(s) it answers. Tapping a plan item highlights its source marks. "An attribution expresses the underlying basis or rationale for a result" `[machine-learning]`
- **AI11** **Optional feedback.** A thumbs-up/down on a plan, placed so it doesn't interrupt, and never required. "Always make providing feedback voluntary." `[generative-ai]`
- **AI12** **Privacy.** Say once, in plain words, that marks and the visible system model are sent to Claude through the Mac, and what is sent. `[generative-ai]`, `[privacy]`
- **AI13** **Non-AI fallback.** Everything a plan does can also be done by hand (add part, add link, edit). "When possible, consider offering a non-AI fallback." `[generative-ai]`
- **AI14** **Hallucination awareness.** Plans that claim facts (e.g. an API's behaviour) are marked as proposals to verify, not truth. "clearly communicate that AI-generated content may contain errors" `[generative-ai]`

---

## 3. Do / don't for buni's screens

**Home**
1. **Do** open on the last system and view the person used (restore state). **Don't** open on a splash or an alert. `[launching]`, `[alerts]`
2. **Do** keep the systems list as a leading sidebar that can be hidden, shown by default.
   **Don't** hide it behind a hamburger. `[sidebars]`
3. **Do** give an empty Home a single clear action ("Open a system on your Mac" with the command). **Don't** show a blank canvas. `[writing]`

**View switch & canvases (Context / System / API / Screens)**

4. **Do** use a centred, equal-width, text-only segmented control with 4 nouns. **Don't** add icons to some segments, or action buttons into it. `[segmented-controls]`
5. **Do** keep each view's camera and selection when switching. **Don't** reset zoom on every switch. `[tab-bars]`
6. **Do** let the pen ink immediately on any view. **Don't** require a "Sketch" toggle. `[apple-pencil-and-scribble]`
7. **Do** make proposed, accepted and removed states readable without colour (dash, tag, strike). **Don't** rely on green/red. `[color]`, `[accessibility]`
8. **Do** switch cards to a simpler level of detail when zoomed out. **Don't** draw text under
   11 dp on screen. `[typography]`
9. **Do** offer +/−/Fit zoom buttons. **Don't** make pinch the only way to zoom. `[accessibility]`

**Tool rail**

10. **Do** keep ≤ 3 groups (tools · colours · undo/redo) with filled icon plus accent for the current tool and size and colour shown on it. **Don't** put borders around icons or tint the whole rail. `[toolbars]`
11. **Do** mirror the rail for left-handed use, via a setting. **Don't** pin it under the drawing hand. `[apple-pencil-and-scribble]`
12. **Do** keep the rail ≥ 12 dp off the screen edge. **Don't** start drags inside the back gesture zone. `[gestures]`
13. **Do** map the S Pen button to the eraser (hold) and the previous tool (click). **Don't** map it to Send, Accept or Clear. `[apple-pencil-and-scribble]`
14. **Do** show a hover cursor with the tool's real size and colour. **Don't** change it with hover height or trigger anything on hover. `[apple-pencil-and-scribble]`

**Marks drawer**

15. **Do** make it a non-modal trailing inspector showing marks grouped by view, each tappable to pan to it. **Don't** make it a modal sheet that blocks drawing. `[sheets]`, `[panels]`
16. **Do** let people delete a mark with undo and no confirmation. **Don't** show "Are you sure?" for one mark. `[alerts]`

**Plan panel**

17. **Do** show "Claude · Plan" in the header, specific progress while drafting, and a Stop button. **Don't** show a lone spinner or "Thinking…". `[generative-ai]`, `[progress-indicators]`
18. **Do** show ghosts on the canvas plus checkboxes in the panel, with **Accept** (filled, trailing, the only prominent button) and **Discard** (plain). **Don't** apply anything before Accept. `[generative-ai]`, `[buttons]`
19. **Do** default removals and renames to unchecked and mark them with a destructive style.
    **Don't** let one Accept silently delete parts. `[generative-ai]`
20. **Do** make Accept and Discard each one undo step, with a toast "Plan applied · Undo".
    **Don't** confirm a discard with an alert. `[undo-and-redo]`, `[alerts]`
21. **Do** link each plan item to its source marks. **Don't** present plan items without provenance. `[machine-learning]`

**Operation sheet (API)**

22. **Do** present it as a trailing inspector that updates when another operation is selected, with the method and path as a noun title. **Don't** stack a second sheet over it. `[panels]`, `[sheets]`
23. **Do** keep schemas collapsed behind disclosure rows. **Don't** dump the full schema open. `[disclosure-controls]`

**Page strip (Screens)**

24. **Do** show labelled thumbnails, highlight the current page, and let people tap or drag to reorder (undoable). **Don't** animate page transitions while scrubbing, and don't use bare dots for more than ~10 pages. `[page-controls]`, `[collections]`, `[drag-and-drop]`

**Waiting screen**

25. **Do** show cached content read-only with a quiet banner when available. Otherwise give one numbered instruction and live auto-detected status. **Don't** use an alert, "Error", or a Retry button that does nothing new. `[alerts]`, `[writing]`
26. **Do** say "Connect the USB cable to your Mac". **Don't** say "We can't find your device". `[writing]`

**Toasts & banners**

27. **Do** use toasts only for undoable outcomes, one at a time, ≥ 8 s with Undo, and announced to TalkBack. **Don't** carry warnings or decisions in a toast. `[accessibility]`, `[feedback]`
28. **Do** use a persistent banner for ongoing states (disconnected, agent unavailable).
    **Don't** re-toast the same problem every few seconds. `[feedback]`

**Everywhere**

29. **Do** let back (gesture or Esc) close the topmost transient first. **Don't** let back leave the app while a popover is open. (Android contract; `[modality]`)
30. **Do** test everything with the pen, a finger, a keyboard, TalkBack, font scale 2.0, both themes, and "Remove animations". `[accessibility]`

---

## 4. Tokens to adopt

Units: dp for layout, sp for text (HIG pt ≈ dp here). "HIG" means stated on a HIG page. "Derived" means taken from Apple platform defaults or reasoned for this device, not stated on a HIG page.

### 4.1 Spacing (4-dp base, 8-dp rhythm)

| token | dp | use | source |
|---|---|---|---|
| `space.1` | 4 | icon-to-label gap, hairline offsets | Derived |
| `space.2` | 8 | between related controls in a group | Derived |
| `space.3` | 12 | padding around bezeled controls; rail inset from edge | HIG `[accessibility]` (≈12 pt) |
| `space.4` | 16 | panel inner padding, card padding | Derived (UIKit) |
| `space.5` | 20 | screen and panel outer margins | Derived (UIKit regular layout margin) |
| `space.6` | 24 | padding around borderless controls; between groups | HIG `[accessibility]` (≈24 pt) |
| `space.8` | 32 | section separation in panels | Derived |
| `space.12` | 48 | large empty-state spacing | Derived |

Layout widths (Derived): tool rail 64; trailing inspector 340 (320–380); Home sidebar
300 (280–320); readable text ≤ 672; top bar height 56 (content) plus status inset.

### 4.2 Corner radii by role (concentric rule is HIG `[toolbars]`; values Derived)

| role | radius dp |
|---|---|
| small control (chip, swatch, checkbox) | 6 |
| button, text field, segmented control (outer) | 10 |
| segment thumb inside a 10-radius control with 2 dp inset | 8 (concentric) |
| card on canvas | 12 |
| popover, menu | 14 |
| inspector, sheet, banner/toast | 20 |
| tool rail, top bar (floating) | 24 (capsule ends on rail; inner buttons = 24 − padding) |

### 4.3 Type scale (sp), from HIG iOS/iPadOS Dynamic Type "Large (default)" `[typography]`

| token | size/leading | weight | buni use |
|---|---|---|---|
| `largeTitle` | 34/41 | Regular (Bold emphasized) | Empty-state headline, waiting screen |
| `title1` | 28/34 | Regular | Home system name |
| `title2` | 22/28 | Regular | Inspector title (or use `headline`) |
| `title3` | 20/25 | Regular / Semibold | Section titles in panels |
| `headline` | 17/22 | Semibold | Card title at 100% zoom; top-bar title |
| `body` | 17/22 | Regular | Plan text, operation descriptions, notes |
| `callout` | 16/21 | Regular | Buttons, segmented labels |
| `subhead` | 15/20 | Regular | List rows, mark rows |
| `footnote` | 13/18 | Regular | Metadata, secondary card lines |
| `caption1` | 12/16 | Regular | Tags ("Proposed"), timestamps |
| `caption2` | 11/13 | Regular | Absolute minimum. Badges only |

Rules: minimum 11 sp (HIG). Avoid Light/Thin weights (HIG). Font family: system (Roboto / Samsung One UI font) or one custom family with matching weights. **Android ⚠** Material 3's type scale (Body Large 16, Label 11–14) is a little smaller. Prefer the HIG sizes above:
17 sp body reads better at tablet arm's length ("people are typically within about 3 feet"
`[designing-for-ipados]`).

### 4.4 Icon sizes (Derived from SF Symbols scales matched to text)

| context | glyph dp | touch target dp |
|---|---|---|
| inline with footnote/caption text | 16 | n/a |
| list rows, menus, inspector actions | 20 | 48 |
| top bar actions | 22 | 48 |
| tool rail tools | 24 | 48 (56 recommended for main pen tools) |
| empty-state illustration glyph | 48–64 | n/a |

### 4.5 Hit sizes

| token | dp | source |
|---|---|---|
| `hit.min` | 48 | Android a11y; meets HIG 44 pt `[buttons]` |
| `hit.hig` | 44 | HIG default control size `[accessibility]` |
| `hit.visualMin` | 28 | HIG minimum control size `[accessibility]` (visual only; pad touch to 48) |
| `hit.tool` | 56 | Derived: primary pen tools, used constantly |
| `hit.canvasHandle` | 32 visual / 48 touch | Derived: link endpoints, resize handles |

### 4.6 Motion (values Derived from Apple platform defaults. HIG gives principles, not numbers)

| token | value | use |
|---|---|---|
| `dur.instant` | 0–100 ms | tool switch, selection, stroke commit (Mo3) |
| `dur.quick` | 150 ms | fades, pressed states, toast in/out, reduced-motion crossfade |
| `dur.standard` | 250 ms | popover open/close, inspector content swap |
| `dur.emphasized` | 350 ms | inspector slide, view switch crossfade, camera pan to undo target |
| `ease.standard` | cubic-bezier(0.2, 0, 0, 1) | non-gesture transitions |
| `spring.ui` | dampingRatio 0.86, stiffness 400 (Compose `Spring.StiffnessMediumLow`) | panels, popovers (no visible bounce) |
| `spring.camera` | dampingRatio 1.0, stiffness 200 | programmatic zoom/fit (no overshoot) |
| `fling` | Compose `exponentialDecay(frictionMultiplier = 1.5)` | canvas pan momentum |
| `highlight.flash` | 600 ms fade-out | "show what undo did" (U3) |
| reduced motion | all slides/zooms → `dur.quick` fade; springs → dampingRatio 1.0 | Mo6, HIG `[accessibility]` |

### 4.7 Elevation levels (HIG concept: content vs control layer `[materials]`, base vs elevated `[dark-mode]`; values Derived)

| level | what | light theme | dark theme |
|---|---|---|---|
| 0 | canvas background | `canvas` | `canvas` (base, darkest) |
| 1 | cards, page images (content layer) | `card` + 1 dp `line` + shadow y1 blur2 4% | `card` + 1 dp `line`, no shadow |
| 2 | floating chrome: top bar, tool rail, page strip | `surface` 94% + hairline + shadow y2 blur8 8% | elevated surface (`surface`), hairline |
| 3 | inspectors, popovers, menus | `surface` + shadow y4 blur16 12% | lighter elevated surface (+4% white over `surface`), hairline |
| 4 | modal sheets, alerts | `surface` + shadow y8 blur24 16%, scrim 30% black | elevated surface, scrim 50% black |

Rules: in dark mode, express elevation by a lighter surface, not a bigger shadow (`[dark-mode]`). Never put glass or translucency on levels 0–1 (`[materials]`). Use one scrim at a time (one modal at a time, `[modality]`).

---

## 5. Android ⚠ summary — which convention wins

| topic | HIG | Android/Material | follow |
|---|---|---|---|
| Hit target | 44 pt | 48 dp | **48 dp** (meets both) |
| System back | none (on-screen Back) | back gesture is a contract | **Android back must work** (G7), plus visible Back in the top bar |
| Edge gestures | don't conflict with system | gesture nav owns edges, ≤ 200 dp exclusion | **Android**: inset chrome, minimal exclusion (G6) |
| Primary action | prominent button, trailing in the toolbar | FAB | **HIG** (no FAB) |
| Navigation of 4 views | segmented control | tabs/nav rail | **HIG** segmented control |
| Bottom sheets | page/form sheet on iPad, centred | full-width bottom sheet | **HIG** centred sheets or trailing inspectors |
| Snackbar timeout | minimize time-boxed UI | 4–10 s snackbar | **HIG intent**: long or indefinite + Undo also on the rail |
| Capitalization | title case default, consistency required | sentence case | **sentence case**, consistently (W1) |
| Appearance | follow system, no in-app toggle | same | follow system (already done) |
| Haptics | iPad has none | vibration available | **Minimal** (H1), respect system setting |
| Font scaling | Dynamic Type | `sp` + font scale up to 200% | `sp` for chrome. Canvas content scales with zoom (T8) |
| Handwriting in fields | Scribble | Android 14 stylus handwriting / S Pen to text | use the platform one; follow HIG Scribble rules (Pen12) |
| Undo gesture | 3-finger swipe | none standard | buttons + 2/3-finger tap + 3-finger swipe (U7) |

---

## 6. Sources read

Foundations: accessibility, app-icons, branding, color, dark-mode, icons, images, inclusion, layout, materials, motion, privacy, right-to-left (skimmed), sf-symbols (principles), typography, writing. Patterns: charting-data, collaboration-and-sharing, drag-and-drop, entering-data, feedback, file-management (skimmed), going-full-screen, launching, loading, managing-notifications (skimmed), modality, multitasking (skimmed), offering-help, onboarding, searching (skimmed), settings, undo-and-redo, playing-haptics. Components: charts, image-views, text-views, boxes, collections, column-views, disclosure-controls, labels, lists-and-tables, lockups, outline-views, split-views, tab-views, activity-views, buttons, context-menus, edit-menus, menus, pop-up-buttons, pull-down-buttons, toolbars (navigation bars now live here), path-controls, search-fields, sidebars, tab-bars, token-fields, action-sheets, alerts, page-controls, panels, popovers, scroll-views, sheets, windows, color-wells, combo-boxes, digit-entry-views, image-wells, pickers, segmented-controls, sliders, steppers, text-fields, toggles, gauges, progress-indicators, rating-indicators. Inputs: apple-pencil-and-scribble (closely), gestures, keyboards (skimmed), pointing-devices (skimmed). Technologies: generative-ai, machine-learning. Platform: designing-for-ipados.
