// frontend/src/utils/theme.js
// Theme management utilities - extracted to avoid circular imports with main.js

const DEFAULT_WA_THEME = 'default'
const DEFAULT_WA_BRAND = 'cyan'

const THEME_TO_PALETTE = { awesome: 'bright', default: 'default', shoelace: 'shoelace' }

const storedSettings = (() => {
    try {
        const raw = localStorage.getItem('twicc-settings')
        return raw ? JSON.parse(raw) : {}
    } catch { return {} }
})()

let currentColorScheme = storedSettings.colorScheme || storedSettings.themeMode || 'system'  // `themeMode` is legacy key
let currentWaTheme = storedSettings.waTheme || DEFAULT_WA_THEME
let currentWaBrand = storedSettings.waBrand || DEFAULT_WA_BRAND

function applyColorScheme() {
    let isDark
    if (currentColorScheme === 'system') {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    } else {
        isDark = currentColorScheme === 'dark'
    }
    document.documentElement.classList.toggle('wa-dark', isDark)
    document.documentElement.dataset.colorScheme = isDark ? 'dark' : 'light'
}

const WA_THEME_CLASSES = ['wa-theme-awesome', 'wa-theme-default', 'wa-theme-shoelace']
const WA_PALETTE_CLASSES = ['wa-palette-bright', 'wa-palette-default', 'wa-palette-shoelace']
const WA_BRAND_CLASSES = ['wa-brand-blue', 'wa-brand-red', 'wa-brand-orange', 'wa-brand-yellow', 'wa-brand-green', 'wa-brand-cyan', 'wa-brand-indigo', 'wa-brand-purple', 'wa-brand-pink', 'wa-brand-gray']

function applyWaClasses() {
    const palette = THEME_TO_PALETTE[currentWaTheme] || 'default'
    const el = document.documentElement
    el.classList.remove(...WA_THEME_CLASSES, ...WA_PALETTE_CLASSES, ...WA_BRAND_CLASSES)
    el.classList.add(
        `wa-theme-${currentWaTheme}`,
        `wa-palette-${palette}`,
        `wa-brand-${currentWaBrand}`,
    )
    document.documentElement.dataset.theme = currentWaTheme
}

// ── Cached theme colors ─────────────────────────────────────────────────
// Recomputed only when the color scheme, WA theme, or brand accent changes.

let _cachedSurfaceColor = ''
let _cachedSelectionColor = ''

/**
 * Resolve a CSS color variable to an rgba() string via 1×1 canvas pixel readback.
 * Needed because modern browsers may return oklch/lab from getComputedStyle,
 * which xterm.js and CodeMirror can't parse.
 */
function resolveColorVariable(varExpr) {
    const el = document.createElement('div')
    el.style.color = varExpr
    document.body.appendChild(el)
    const computed = getComputedStyle(el).color
    el.remove()

    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = computed
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`
}

function recomputeCachedColors() {
    _cachedSurfaceColor = resolveColorVariable('var(--wa-color-surface-default)')
    _cachedSelectionColor = resolveColorVariable('var(--selection-bg-color)')
}

/** Cached surface background color (e.g. for terminal/editor backgrounds). */
export function getSurfaceColor() {
    return _cachedSurfaceColor
}

/** Cached selection background color (e.g. for terminal/editor selections). */
export function getSelectionColor() {
    return _cachedSelectionColor
}

// ── Public setters (invalidate cache after applying) ────────────────────

export function setColorScheme(mode) {
    currentColorScheme = mode
    applyColorScheme()
    recomputeCachedColors()
}

export function setWaTheme(theme) {
    currentWaTheme = theme
    applyWaClasses()
    recomputeCachedColors()
}

export function setWaBrand(brand) {
    currentWaBrand = brand
    applyWaClasses()
    recomputeCachedColors()
}

/**
 * Initialize theme on app startup.
 * Apply initial color scheme and WA classes, listen for system preference changes.
 */
export function initTheme() {
    applyColorScheme()
    applyWaClasses()
    recomputeCachedColors()
    document.documentElement.classList.remove('loading')
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        applyColorScheme()
        recomputeCachedColors()
    })
}
