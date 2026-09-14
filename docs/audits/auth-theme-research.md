# Authentication Theme and Form Contrast

## Decision

Use dark for a browser with no valid saved theme. Preserve an explicit saved light, dark, or beach selection. Apply the selection before the authentication interface renders, and use the same selection after React starts. Light mode must render a light form with dark text, rather than placing dark text into a fixed-dark input. Beach remains an explicitly selected high-contrast variant; it is not the first-visit default.

This is a product decision, not a scientific claim that dark is universally more readable. Accessibility guidance specifies distinguishable foreground/background pairs and visible controls; it does not designate one theme as best for every person or lighting condition. A saved light preference should therefore retain its meaning. The relevant implementation obligation is to make each supported theme internally coherent and readable.[1][2]

| Situation | Result |
|---|---|
| Saved light | Light page, card and fields; dark text; light native controls |
| Saved dark | Dark page and fields; light text; dark native controls |
| Saved beach | Blacker surfaces and brighter text; dark native controls |
| No saved value | Dark, including when the device prefers light |
| Empty, unknown or malformed saved value | Dark |
| Browser storage access denied | Dark initially; in-session switching still works |
| Theme switched during a form | Entered values and password semantics remain intact |

The previous implementation used device preference and then light for a first visit. The new policy intentionally replaces that fallback. It does not override a valid saved light preference. Persistence is browser- and origin-specific, not evidence of an account-level preference that automatically follows a person across devices or preview URLs.[3]

## Findings in the existing interface

The reported access-code defect was reproduced directly: the input had a dark zinc background, an ordinary white-text utility, and a light-theme ancestor. The theme stylesheet contained an important dark input foreground rule. That declaration won over the ordinary white utility, leaving RGB(17,24,39) text on RGB(39,39,42). The root cause was the CSS cascade, not the code-verification request or a missing keystroke. Beach mode had an analogous dark foreground override.

The access screen is intentionally fixed-dark. It now has scoped white text and caret declarations and a lighter placeholder. The scope is limited to its input, so ordinary forms retain their theme foreground. Changing every input globally to white would have created the reverse failure on light forms.

Login and signup already had dedicated input classes, but several surrounding surfaces still used fixed dark colors: the tab strip, role choices, badges, footer and terms panel. On a light page, this produced a mixed appearance and left text dependent on the wrong background assumptions. Those surfaces and their text now use the selected theme’s tokens. The authentication component’s parsed structure was compared before and after, excluding styling attributes; all remaining structure and behavior matched. Submission handling, verification endpoints, role logic and account creation were not changed.

Theme initialization also trusted any nonempty stored string. An unexpected value could select no supported theme, and a string containing spaces could reach the DOM class API. Storage reads and writes were unguarded. Browser storage can raise a SecurityError when persistence is disallowed; a presentation preference must not prevent rendering the sign-in interface.[3]

## Research implications

### Text and placeholders

WCAG’s normal-text contrast threshold is 4.5:1, with a separate 3:1 threshold for qualifying large text. Placeholders are included in its explanation of text contrast. The threshold is evaluated without rounding a value upward into a pass. The actual foreground and background matter; names such as muted, light or white are not measurements.[1]

The repaired auth fields use explicit opaque placeholder colors rather than reducing the foreground with an alpha value. This makes the intended pair easier to calculate and review. Entered text has substantial margin above the normal-text threshold in all three measured themes. Placeholder contrast also exceeds that threshold.

### Control boundaries and focus

The non-text contrast criterion addresses visual information needed to identify controls and their states. A form boundary should be distinguishable where it is needed to locate an input; text contrast alone is not the complete assessment.[2] The auth-specific border tokens are therefore stronger than the previous pale general-purpose border tokens. Each measured field boundary exceeds 3:1 against both its fill and the adjacent card color. The keyboard-focused auth input also receives an explicit outline in a theme-specific focus color.

This does not establish WCAG conformance for the entire application. It assesses specific color pairs. Other components, keyboard navigation, labels, errors, zoom and assistive-technology behavior require their own acceptance. Accessible names are present on the examined fields, but visible persistent labels remain a separate usability review; placeholder instructions disappear during entry.[6]

### Native controls and autofill

CSS `color-scheme` communicates supported rendering colors to the browser for native controls and related UI. It does not recolor the application’s custom cards and text automatically.[4] The root now declares light for the light theme and dark for dark or beach, while custom form surfaces explicitly use matching colors.

Browser autofill can introduce user-agent styles with important declarations. A normal application rule does not necessarily override those styles.[5] This repair does not add a long-delay animation or inset-shadow trick to conceal autofill styling. Native password-manager and autofill behavior still needs device/browser verification. The computed-style measurements reported below concern normal rendered inputs, not a claim about every autofill state.

### Startup consistency

An early head script resolves the saved choice before styles and the React interface paint. React applies the same allowlist and fallback policy. Tests execute the early script as well as the provider for the same saved values, so a future change to only one policy is detected. The default HTML class is dark, and the selected color scheme and browser theme-color metadata are applied during bootstrap.

The early script and provider contain a small duplicated policy because the public HTML must execute before the application bundle. Their parity is tested rather than assumed. Existing unrelated root classes are preserved. No authentication state is read by this theme bootstrap.

## Implemented behavior

The theme provider accepts only light, dark and beach. Any other initial value falls back to dark. Invalid switch requests leave the current valid choice untouched. Storage exceptions are caught around preference access; the active React state and root theme can still change for the current session when saving is unavailable.

The first-visit rule is stable regardless of device light/dark preference. This prevents the initial signup appearance from changing simply because a browser reports light preference. A returning browser with a saved light choice still receives light. The application continues using the existing storage key, preserving previously valid choices without migration or resetting them.

The auth page defines local field, muted-text, border and focus tokens. The light form uses an RGB(245,245,245) field with RGB(26,26,26) text. Dark uses RGB(38,38,38) with RGB(250,250,250). Beach uses RGB(20,20,20) with white. Surrounding signup surfaces use the existing semantic card, secondary and foreground colors. The fixed-dark access-code gate retains its separate white-entry rule.

## Measured contrast

The browser rendered real authentication component markup with compiled application CSS. All four examined surfer-signup fields—name, username, email and password—reported the same color pairs within each theme. The border-to-card calculation uses the adjacent source-defined card color. Calculations use the standard sRGB relative-luminance formula and unrounded ratios for threshold checks; displayed values are rounded only for readability.

| Theme | Entered text / field | Placeholder / field | Border / field | Border / card |
|---|---:|---:|---:|---:|
| Light | 15.96:1 | 5.27:1 | 4.35:1 | 4.74:1 |
| Dark | 14.50:1 | 6.00:1 | 4.50:1 | 4.90:1 |
| Beach | 18.42:1 | 10.02:1 | 6.47:1 | 6.82:1 |

The contrast result is limited to these rendered states. The visual fixture omits remote fonts and the logo asset and is not an authenticated production session. It verifies the compiled CSS cascade and actual component markup, while deployment checks establish that the same application changes build and ship.

## Verification and interpretation

Fourteen theme tests cover saved-choice parity between bootstrap and React, both device-preference directions with no saved choice, invalid values, storage denial, preservation of unrelated root classes, normal switching and beach metadata. Thirteen form tests cover login plus surfer, photographer and business signup under each theme, and preservation of entered email/password values through a theme change. Authentication and router calls are explicitly bounded test dependencies in that form suite; it is not an account-creation test.

The full local frontend suite passed 2,445 tests across 252 suites. Browser contrast checks then exercised the compiled stylesheet rather than relying on simulated-DOM color support. The component structure comparison checks that non-styling auth logic stays intact. These methods answer different questions: state tests check selection and persistence; browser measurements check resolved colors; the structural comparison limits unintended behavior changes.

The first strict local production build treated the repository’s accessibility warnings as fatal. The existing build workflow uses CI=false for compilation and a separate shrink-only lint gate. The configured production build passed. The separate repository lint gate also passed: 1,096 files checked, with 154 existing errors and 923 warnings within the recorded baseline; no never-zero rule fired or baseline exceeded. The strict-build failure is retained as evidence. This is not a lint-clean repository or a claim that existing accessibility debt is repaired.

## Release boundaries

The theme changes extend the existing access-contrast pull request. The scoped implementation and this research report are published through PR28, with the updated description and verification evidence. A push is distinct from merge and deployment; remote checks must be reported at their actual completion state.

The weather geometry candidate is separate. Its Linux CI has passed, but theme/color results do not establish a correct marine renderer. Its authenticated preview session is now available, removing the earlier login blocker. The remaining weather acceptance still requires real field rendering, a stationary noise control, and a time change that is visible in both served data and pixels. Neither this theme repair nor its research supplies that proof.

## Sources

1. W3C WAI. [Understanding SC 1.4.3: Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Accessed September 14, 2026. Text, placeholder and threshold interpretation.
2. W3C WAI. [Understanding SC 1.4.11: Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Accessed September 14, 2026. Control and state contrast.
3. MDN contributors. [Window: localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage). Accessed September 14, 2026. Persistence scope and access exceptions.
4. MDN contributors. [color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme). Accessed September 14, 2026. Native control rendering and distinction from authored colors.
5. MDN contributors. [:autofill](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:autofill). Accessed September 14, 2026. Browser-owned autofill styles and limitations.
6. W3C WAI. [Labeling Controls](https://www.w3.org/WAI/tutorials/forms/labels/). Accessed September 14, 2026. Persistent labels and accessible form identification.

Repository evidence accompanies this report: theme and form test reports, full-suite output, compiled CSS and component fragments, contrast calculations, build/lint results, and the styling-only authentication comparison. Source findings refer to the isolated access-code-contrast candidate, not to uncommitted work elsewhere in the workspace.

