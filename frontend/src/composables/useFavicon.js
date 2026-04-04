/**
 * useFavicon — Dynamically updates the browser favicon with a colored dot
 * in the top-right area based on global session state.
 *
 * Two independent signals are tracked:
 * - hasAssistantTurn: at least one session is actively working
 * - hasUnread: at least one session has unread content
 *
 * Animation cycle:
 * - Neither active → original favicon (no animation)
 * - One active → 2-step cycle: default → colored dot (1s each)
 * - Both active → 4-step cycle: default → blue dot → default → orange dot
 *
 * The three possible favicon data URLs (default, blue dot, orange dot) are
 * pre-generated once when the base SVG is loaded, then reused from cache.
 */
import { watch, ref, computed, onBeforeUnmount } from 'vue'
import { useDataStore } from '../stores/data'

/** CSS variable names for dot colors. */
const DOT_CSS_VARS = {
    assistant_turn: '--wa-color-brand-60',
    unread: '--wa-color-warning-60',
}

/** Dot size and position within the 100×100 viewBox (top-right area). */
const DOT_RADIUS = 20
const DOT_CX = 80
const DOT_CY = 20

/**
 * Resolve a CSS custom property to its computed value.
 */
function resolveCssColor(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
}

/**
 * Build a composed SVG string: base favicon + optional colored dot in top-right.
 */
function buildComposedSvg(baseViewBox, baseInnerHtml, dotColor) {
    const dotSvg = dotColor
        ? `<circle cx="${DOT_CX}" cy="${DOT_CY}" r="${DOT_RADIUS}" fill="${dotColor}"/>`
        : ''

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
            `<svg viewBox="${baseViewBox}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet">` +
                baseInnerHtml +
            '</svg>' +
            dotSvg +
        '</svg>'
    )
}

/**
 * Convert an SVG string to a data: URL.
 */
function svgToDataUrl(svgString) {
    return `data:image/svg+xml,${encodeURIComponent(svgString)}`
}

/**
 * Composable: watches global process state and updates the browser favicon
 * with a colored dot overlay, cycling through steps.
 */
export function useFavicon() {
    const store = useDataStore()

    // ── Computed state ─────────────────────────────────────────────────
    const hasAssistantTurn = computed(() => store.hasGlobalAssistantTurn)
    const hasUnread = computed(() => store.getGlobalUnreadCount > 0)

    /**
     * Animation cycle steps. Each step is a key into cachedUrls.
     * - Neither active → null (no cycle)
     * - One active → ['default', dotKey] (2-step)
     * - Both active → ['default', 'assistant_turn', 'default', 'unread'] (4-step)
     */
    const cycleSteps = computed(() => {
        const a = hasAssistantTurn.value
        const u = hasUnread.value

        if (!a && !u) return null

        if (a && u) {
            return ['default', 'assistant_turn', 'default', 'unread']
        }

        return ['default', a ? 'assistant_turn' : 'unread']
    })

    // ── DOM references ─────────────────────────────────────────────────
    const linkEl = document.querySelector('link[rel="icon"][type="image/svg+xml"]')
    const originalHref = linkEl?.getAttribute('href')

    // Base SVG info (loaded asynchronously from the original favicon)
    const baseSvg = ref(null)
    let animationInterval = null

    // Pre-generated data URLs for the 3 favicon variants: { default, assistant_turn, unread }
    let cachedUrls = null

    /**
     * Build and cache the 3 favicon data URLs from the loaded base SVG.
     */
    function buildCache(base) {
        const defaultSvg = buildComposedSvg(base.viewBox, base.innerHTML, null)
        const blueSvg = buildComposedSvg(base.viewBox, base.innerHTML, resolveCssColor(DOT_CSS_VARS.assistant_turn))
        const orangeSvg = buildComposedSvg(base.viewBox, base.innerHTML, resolveCssColor(DOT_CSS_VARS.unread))
        cachedUrls = {
            default: svgToDataUrl(defaultSvg),
            assistant_turn: svgToDataUrl(blueSvg),
            unread: svgToDataUrl(orangeSvg),
        }
    }

    // Fetch and parse the original favicon SVG
    if (originalHref) {
        fetch(originalHref)
            .then((r) => r.text())
            .then((svgText) => {
                const parser = new DOMParser()
                const doc = parser.parseFromString(svgText, 'image/svg+xml')
                const svgEl = doc.documentElement
                const base = {
                    viewBox: svgEl.getAttribute('viewBox'),
                    innerHTML: svgEl.innerHTML,
                }
                buildCache(base)
                baseSvg.value = base
            })
            .catch(() => {
                // Fetch failed — favicon stays unchanged
            })
    }

    // ── Helpers ────────────────────────────────────────────────────────

    function renderStep(stepKey) {
        if (!linkEl || !cachedUrls) return
        linkEl.setAttribute('href', cachedUrls[stepKey])
    }

    function restoreFavicon() {
        if (linkEl && originalHref) {
            linkEl.setAttribute('href', originalHref)
        }
    }

    function clearAnimation() {
        if (animationInterval !== null) {
            clearInterval(animationInterval)
            animationInterval = null
        }
    }

    // ── Reactive watcher ───────────────────────────────────────────────
    watch(
        [cycleSteps, baseSvg],
        ([steps]) => {
            clearAnimation()

            if (!steps) {
                restoreFavicon()
                return
            }

            // Start at first step
            let stepIndex = 0
            renderStep(steps[stepIndex])

            // Cycle through steps
            animationInterval = setInterval(() => {
                stepIndex = (stepIndex + 1) % steps.length
                renderStep(steps[stepIndex])
            }, 1000)
        },
        { immediate: true }
    )

    // ── Cleanup ────────────────────────────────────────────────────────
    onBeforeUnmount(() => {
        clearAnimation()
        restoreFavicon()
    })
}
