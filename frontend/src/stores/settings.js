// frontend/src/stores/settings.js
// Persistent settings store with localStorage + backend sync for global settings

import { defineStore, acceptHMRUpdate } from 'pinia'
import { watch, nextTick } from 'vue'
import { DEFAULT_DISPLAY_MODE, DEFAULT_COLOR_SCHEME, DEFAULT_SESSION_TIME_FORMAT, DEFAULT_MAX_CACHED_SESSIONS, DISPLAY_MODE, COLOR_SCHEME, SESSION_TIME_FORMAT, PERMISSION_MODE, MODEL, EFFORT, CONTEXT_MAX, SYNCED_SETTINGS_KEYS, WA_THEME, WA_BRAND, WA_THEME_DEFAULT_PALETTE } from '../constants'
import { NOTIFICATION_SOUNDS } from '../utils/notificationSounds'
// Note: useDataStore is imported lazily to avoid circular dependency (settings.js ↔ data.js)
import { setColorScheme as setColorSchemeOnDom, setWaTheme, setWaBrand } from '../utils/theme'

const STORAGE_KEY = 'twicc-settings'

/**
 * Settings schema with default values.
 * When adding new settings: add them here with their default value.
 * When removing settings: just remove them from here (they'll be cleaned from localStorage).
 *
 * Synced settings (those in SYNCED_SETTINGS_KEYS) use null as placeholder here.
 * Their real defaults are provided by the backend via /api/bootstrap/ and injected
 * into this object by applyDefaultSettings() before the store is initialized.
 */
export const SETTINGS_SCHEMA = {
    // --- Local-only settings (defaults defined here) ---
    displayMode: DEFAULT_DISPLAY_MODE,
    fontSize: 16,
    colorScheme: DEFAULT_COLOR_SCHEME,
    sessionTimeFormat: DEFAULT_SESSION_TIME_FORMAT,
    showCosts: false,
    extraUsageOnlyWhenNeeded: true,
    maxCachedSessions: DEFAULT_MAX_CACHED_SESSIONS,
    showDiffs: true,
    toolDiffWordWrap: true,
    toolDiffSideBySide: false,
    diffSideBySide: true,
    editorWordWrap: true,
    compactSessionList: false,
    showArchivedSessions: false,
    showArchivedProjects: false,
    showArchivedWorkspaces: false,
    notifUserTurnSound: NOTIFICATION_SOUNDS.NONE,
    notifUserTurnBrowser: false,
    notifPendingRequestSound: NOTIFICATION_SOUNDS.NONE,
    notifPendingRequestBrowser: false,
    // --- Synced settings (defaults from backend, null as placeholder) ---
    titleGenerationEnabled: null,
    titleAutoApply: null,
    titleSystemPrompt: null,
    autoUnpinOnArchive: null,
    terminalUseTmux: null,
    defaultPermissionMode: null,
    defaultModel: null,
    defaultEffort: null,
    defaultThinking: null,
    defaultClaudeInChrome: null,
    defaultContextMax: null,
    waTheme: null,
    waBrand: null,
    usageJsonFileEnabled: null,
    usageJsonFilePath: null,
    usageDumpFileEnabled: null,
    usageDumpFilePath: null,
    // --- Not persisted - runtime state ---
    _devMode: false,
    _uvxMode: false,
    _effectiveColorScheme: null,
    _isTouchDevice: false,
    _isMac: false,
    _isApplyingRemoteSettings: false,
}

/**
 * Validators for each setting.
 * Returns true if the value is valid, false otherwise.
 * Invalid values will be replaced with defaults.
 */
const SETTINGS_VALIDATORS = {
    displayMode: (v) => [DISPLAY_MODE.CONVERSATION, DISPLAY_MODE.SIMPLIFIED, DISPLAY_MODE.NORMAL, DISPLAY_MODE.DEBUG].includes(v),
    fontSize: (v) => typeof v === 'number' && v >= 12 && v <= 32,
    colorScheme: (v) => [COLOR_SCHEME.SYSTEM, COLOR_SCHEME.LIGHT, COLOR_SCHEME.DARK].includes(v),
    sessionTimeFormat: (v) => [SESSION_TIME_FORMAT.TIME, SESSION_TIME_FORMAT.RELATIVE_SHORT, SESSION_TIME_FORMAT.RELATIVE_NARROW].includes(v),
    titleGenerationEnabled: (v) => typeof v === 'boolean',
    titleAutoApply: (v) => typeof v === 'boolean',
    titleSystemPrompt: (v) => typeof v === 'string' && v.includes('{text}'),
    showCosts: (v) => typeof v === 'boolean',
    extraUsageOnlyWhenNeeded: (v) => typeof v === 'boolean',
    maxCachedSessions: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 50,
    autoUnpinOnArchive: (v) => typeof v === 'boolean',
    terminalUseTmux: (v) => typeof v === 'boolean',
    showDiffs: (v) => typeof v === 'boolean',
    toolDiffWordWrap: (v) => typeof v === 'boolean',
    toolDiffSideBySide: (v) => typeof v === 'boolean',
    diffSideBySide: (v) => typeof v === 'boolean',
    editorWordWrap: (v) => typeof v === 'boolean',
    compactSessionList: (v) => typeof v === 'boolean',
    showArchivedSessions: (v) => typeof v === 'boolean',
    showArchivedProjects: (v) => typeof v === 'boolean',
    showArchivedWorkspaces: (v) => typeof v === 'boolean',
    defaultPermissionMode: (v) => Object.values(PERMISSION_MODE).includes(v),
    defaultModel: (v) => Object.values(MODEL).includes(v),
    defaultEffort: (v) => Object.values(EFFORT).includes(v),
    defaultThinking: (v) => typeof v === 'boolean',
    defaultClaudeInChrome: (v) => typeof v === 'boolean',
    defaultContextMax: (v) => Object.values(CONTEXT_MAX).includes(v),
    notifUserTurnSound: (v) => Object.values(NOTIFICATION_SOUNDS).includes(v),
    notifUserTurnBrowser: (v) => typeof v === 'boolean',
    notifPendingRequestSound: (v) => Object.values(NOTIFICATION_SOUNDS).includes(v),
    notifPendingRequestBrowser: (v) => typeof v === 'boolean',
    waTheme: (v) => Object.values(WA_THEME).includes(v),
    waBrand: (v) => Object.values(WA_BRAND).includes(v),
    usageJsonFileEnabled: (v) => typeof v === 'boolean',
    usageJsonFilePath: (v) => typeof v === 'string',
    usageDumpFileEnabled: (v) => typeof v === 'boolean',
    usageDumpFilePath: (v) => typeof v === 'string',
}

/**
 * Load settings from localStorage, merge with schema, and clean up.
 * - Unknown keys (removed settings) are discarded
 * - Missing keys (new settings) get default values
 * - Invalid values get replaced with defaults
 * @returns {Object} Clean settings object matching the schema
 */
function loadSettings() {
    const settings = { ...SETTINGS_SCHEMA }

    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
            const parsed = JSON.parse(stored)

            // Migrate legacy baseDisplayMode + debugEnabled → displayMode
            if ('baseDisplayMode' in parsed || 'debugEnabled' in parsed) {
                const debugEnabled = parsed.debugEnabled === true
                const baseMode = parsed.baseDisplayMode || DEFAULT_DISPLAY_MODE
                parsed.displayMode = debugEnabled ? DISPLAY_MODE.DEBUG : baseMode
                delete parsed.baseDisplayMode
                delete parsed.debugEnabled
            }

            // Migrate themeMode → colorScheme
            if (!('colorScheme' in parsed) && 'themeMode' in parsed) {
                parsed.colorScheme = parsed.themeMode
            }

            // Only keep keys that exist in schema and have valid values
            // Skip _-prefixed keys (runtime state, not persisted)
            for (const key of Object.keys(SETTINGS_SCHEMA)) {
                if (key.startsWith('_')) continue
                if (key in parsed) {
                    const validator = SETTINGS_VALIDATORS[key]
                    if (!validator || validator(parsed[key])) {
                        settings[key] = parsed[key]
                    }
                    // If validation fails, keep the default
                }
            }
        }
    } catch (e) {
        console.warn('Failed to load settings from localStorage:', e)
    }

    // Save cleaned settings back to localStorage
    saveSettings(settings)

    return settings
}

/**
 * Save settings to localStorage.
 * @param {Object} settings - Settings object to save
 */
function saveSettings(settings) {
    try {
        // Exclude _-prefixed keys (runtime state, not persisted)
        const toSave = {}
        for (const [key, value] of Object.entries(settings)) {
            if (!key.startsWith('_')) toSave[key] = value
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
    } catch (e) {
        console.warn('Failed to save settings to localStorage:', e)
    }
}

export const useSettingsStore = defineStore('settings', {
    state: () => loadSettings(),

    getters: {
        /**
         * Current display mode: 'simplified', 'normal', or 'debug'.
         */
        getDisplayMode: (state) => state.displayMode,
        getFontSize: (state) => state.fontSize,
        getColorScheme: (state) => state.colorScheme,
        getSessionTimeFormat: (state) => state.sessionTimeFormat,
        isTitleGenerationEnabled: (state) => state.titleGenerationEnabled,
        isTitleAutoApply: (state) => state.titleAutoApply,
        getTitleSystemPrompt: (state) => state.titleSystemPrompt,
        areCostsShown: (state) => state.showCosts,
        isExtraUsageOnlyWhenNeeded: (state) => state.extraUsageOnlyWhenNeeded,
        getMaxCachedSessions: (state) => state.maxCachedSessions,
        isAutoUnpinOnArchive: (state) => state.autoUnpinOnArchive,
        isTerminalUseTmux: (state) => state.terminalUseTmux,
        isShowDiffs: (state) => state.showDiffs,
        isToolDiffWordWrap: (state) => state.toolDiffWordWrap,
        isToolDiffSideBySide: (state) => state.toolDiffSideBySide,
        isDiffSideBySide: (state) => state.diffSideBySide,
        isEditorWordWrap: (state) => state.editorWordWrap,
        isCompactSessionList: (state) => state.compactSessionList,
        isShowArchivedSessions: (state) => state.showArchivedSessions,
        isShowArchivedProjects: (state) => state.showArchivedProjects,
        isShowArchivedWorkspaces: (state) => state.showArchivedWorkspaces,
        getDefaultPermissionMode: (state) => state.defaultPermissionMode,
        getDefaultModel: (state) => state.defaultModel,
        getDefaultEffort: (state) => state.defaultEffort,
        getDefaultThinking: (state) => state.defaultThinking,
        getDefaultClaudeInChrome: (state) => state.defaultClaudeInChrome,
        getDefaultContextMax: (state) => state.defaultContextMax,
        getNotifUserTurnSound: (state) => state.notifUserTurnSound,
        isNotifUserTurnBrowser: (state) => state.notifUserTurnBrowser,
        getNotifPendingRequestSound: (state) => state.notifPendingRequestSound,
        isNotifPendingRequestBrowser: (state) => state.notifPendingRequestBrowser,
        getWaTheme: (state) => state.waTheme,
        getWaBrand: (state) => state.waBrand,
        isUsageJsonFileEnabled: (state) => state.usageJsonFileEnabled,
        getUsageJsonFilePath: (state) => state.usageJsonFilePath,
        isUsageDumpFileEnabled: (state) => state.usageDumpFileEnabled,
        getUsageDumpFilePath: (state) => state.usageDumpFilePath,
        /**
         * Whether the backend is running in dev mode (source layout) vs installed package.
         */
        isDevMode: (state) => state._devMode,
        /**
         * Whether the app was launched via `uvx twicc` (ephemeral) vs installed package.
         */
        isUvxMode: (state) => state._uvxMode,
        /**
         * Effective color scheme: always returns 'light' or 'dark', never 'system'.
         */
        getEffectiveColorScheme: (state) => state._effectiveColorScheme,
        /**
         * Whether the primary input device is touch (no hover support).
         * Detected once at startup. Used to disable tooltips on touch devices.
         */
        isTouchDevice: (state) => state._isTouchDevice,
        /**
         * Whether the user is on macOS.
         * Detected once at startup. Used to display platform-appropriate key names.
         */
        isMac: (state) => state._isMac,
    },

    actions: {
        /**
         * Set display mode.
         * @param {string} mode - 'simplified' | 'normal' | 'debug'
         */
        setDisplayMode(mode) {
            if (SETTINGS_VALIDATORS.displayMode(mode)) {
                this.displayMode = mode
            }
        },

        /**
         * Set the global font size.
         * @param {number} size - Font size in pixels (12-32)
         */
        setFontSize(size) {
            const numSize = Number(size)
            if (SETTINGS_VALIDATORS.fontSize(numSize)) {
                this.fontSize = numSize
            }
        },

        setColorScheme(mode) {
            if (SETTINGS_VALIDATORS.colorScheme(mode)) {
                this.colorScheme = mode
            }
        },

        /**
         * Set the session time format.
         * @param {string} format - 'time' | 'relative'
         */
        setSessionTimeFormat(format) {
            if (SETTINGS_VALIDATORS.sessionTimeFormat(format)) {
                this.sessionTimeFormat = format
            }
        },

        /**
         * Toggle title generation enabled/disabled.
         * @param {boolean} enabled
         */
        setTitleGenerationEnabled(enabled) {
            if (SETTINGS_VALIDATORS.titleGenerationEnabled(enabled)) {
                this.titleGenerationEnabled = enabled
            }
        },

        /**
         * Toggle title auto-apply enabled/disabled.
         * @param {boolean} enabled
         */
        setTitleAutoApply(enabled) {
            if (SETTINGS_VALIDATORS.titleAutoApply(enabled)) {
                this.titleAutoApply = enabled
            }
        },

        /**
         * Set the title system prompt.
         * @param {string} prompt - Must contain {text} placeholder
         */
        setTitleSystemPrompt(prompt) {
            if (SETTINGS_VALIDATORS.titleSystemPrompt(prompt)) {
                this.titleSystemPrompt = prompt
            }
        },

        /**
         * Reset the title system prompt to default.
         */
        resetTitleSystemPrompt() {
            this.titleSystemPrompt = SETTINGS_SCHEMA.titleSystemPrompt
        },

        /**
         * Set costs display enabled/disabled.
         * @param {boolean} enabled
         */
        setShowCosts(enabled) {
            if (SETTINGS_VALIDATORS.showCosts(enabled)) {
                this.showCosts = enabled
            }
        },

        /**
         * Set extra usage "only when needed" mode.
         * @param {boolean} enabled
         */
        setExtraUsageOnlyWhenNeeded(enabled) {
            if (SETTINGS_VALIDATORS.extraUsageOnlyWhenNeeded(enabled)) {
                this.extraUsageOnlyWhenNeeded = enabled
            }
        },

        /**
         * Set the maximum number of cached sessions (KeepAlive).
         * @param {number} count - Number of sessions to keep alive (1-50)
         */
        setMaxCachedSessions(count) {
            const numCount = Number(count)
            if (SETTINGS_VALIDATORS.maxCachedSessions(numCount)) {
                this.maxCachedSessions = numCount
            }
        },

        /**
         * Set auto-unpin on archive enabled/disabled.
         * @param {boolean} enabled
         */
        setAutoUnpinOnArchive(enabled) {
            if (SETTINGS_VALIDATORS.autoUnpinOnArchive(enabled)) {
                this.autoUnpinOnArchive = enabled
            }
        },

        /**
         * Set terminal tmux persistence enabled/disabled.
         * @param {boolean} enabled
         */
        setTerminalUseTmux(enabled) {
            if (SETTINGS_VALIDATORS.terminalUseTmux(enabled)) {
                this.terminalUseTmux = enabled
            }
        },

        /**
         * Set show diffs (auto-expand Edit/Write tool details for live items only).
         * @param {boolean} enabled
         */
        setShowDiffs(enabled) {
            if (SETTINGS_VALIDATORS.showDiffs(enabled)) {
                this.showDiffs = enabled
            }
        },

        /**
         * Set tool diff word wrap default (for Edit/Write diffs in sessions).
         * @param {boolean} enabled
         */
        setToolDiffWordWrap(enabled) {
            if (SETTINGS_VALIDATORS.toolDiffWordWrap(enabled)) {
                this.toolDiffWordWrap = enabled
            }
        },

        /**
         * Set tool diff side-by-side default (for Edit/Write diffs in sessions).
         * @param {boolean} enabled
         */
        setToolDiffSideBySide(enabled) {
            if (SETTINGS_VALIDATORS.toolDiffSideBySide(enabled)) {
                this.toolDiffSideBySide = enabled
            }
        },

        /**
         * Set diff side-by-side default mode (for the editor/git panel).
         * @param {boolean} enabled
         */
        setDiffSideBySide(enabled) {
            if (SETTINGS_VALIDATORS.diffSideBySide(enabled)) {
                this.diffSideBySide = enabled
            }
        },

        /**
         * Set editor word wrap mode.
         * @param {boolean} enabled
         */
        setEditorWordWrap(enabled) {
            if (SETTINGS_VALIDATORS.editorWordWrap(enabled)) {
                this.editorWordWrap = enabled
            }
        },

        /**
         * Set compact session list mode.
         * @param {boolean} enabled
         */
        setCompactSessionList(enabled) {
            if (SETTINGS_VALIDATORS.compactSessionList(enabled)) {
                this.compactSessionList = enabled
            }
        },

        /**
         * Set show archived sessions mode.
         * This setting is not exposed in the settings panel — it is only
         * toggled from the session list options dropdown in the sidebar.
         * @param {boolean} enabled
         */
        setShowArchivedSessions(enabled) {
            if (SETTINGS_VALIDATORS.showArchivedSessions(enabled)) {
                this.showArchivedSessions = enabled
            }
        },

        /**
         * Set show archived projects mode.
         * This setting is not exposed in the settings panel — it is only
         * toggled from the home page project list.
         * @param {boolean} enabled
         */
        setShowArchivedProjects(enabled) {
            if (SETTINGS_VALIDATORS.showArchivedProjects(enabled)) {
                this.showArchivedProjects = enabled
            }
        },

        /**
         * Set show archived workspaces mode.
         * This setting is not exposed in the settings panel — it is only
         * toggled from the workspace list UI.
         * @param {boolean} enabled
         */
        setShowArchivedWorkspaces(value) {
            this.showArchivedWorkspaces = value
        },

        /**
         * Set the default permission mode for new sessions.
         * @param {string} mode - One of PERMISSION_MODE values
         */
        setDefaultPermissionMode(mode) {
            if (SETTINGS_VALIDATORS.defaultPermissionMode(mode)) {
                this.defaultPermissionMode = mode
            }
        },

        setDefaultModel(model) {
            if (SETTINGS_VALIDATORS.defaultModel(model)) {
                this.defaultModel = model
            }
        },

        setDefaultEffort(effort) {
            if (SETTINGS_VALIDATORS.defaultEffort(effort)) {
                this.defaultEffort = effort
            }
        },

        setDefaultThinking(thinking) {
            if (SETTINGS_VALIDATORS.defaultThinking(thinking)) {
                this.defaultThinking = thinking
            }
        },

        setDefaultClaudeInChrome(enabled) {
            if (SETTINGS_VALIDATORS.defaultClaudeInChrome(enabled)) {
                this.defaultClaudeInChrome = enabled
            }
        },

        setDefaultContextMax(contextMax) {
            if (SETTINGS_VALIDATORS.defaultContextMax(contextMax)) {
                this.defaultContextMax = contextMax
            }
        },

        /**
         * Set notification sound for user turn events.
         * @param {string} sound - One of NOTIFICATION_SOUNDS values
         */
        setNotifUserTurnSound(sound) {
            if (SETTINGS_VALIDATORS.notifUserTurnSound(sound)) {
                this.notifUserTurnSound = sound
            }
        },

        /**
         * Set browser notification for user turn events.
         * @param {boolean} enabled
         */
        setNotifUserTurnBrowser(enabled) {
            if (SETTINGS_VALIDATORS.notifUserTurnBrowser(enabled)) {
                this.notifUserTurnBrowser = enabled
            }
        },

        /**
         * Set notification sound for pending request events.
         * @param {string} sound - One of NOTIFICATION_SOUNDS values
         */
        setNotifPendingRequestSound(sound) {
            if (SETTINGS_VALIDATORS.notifPendingRequestSound(sound)) {
                this.notifPendingRequestSound = sound
            }
        },

        /**
         * Set browser notification for pending request events.
         * @param {boolean} enabled
         */
        setNotifPendingRequestBrowser(enabled) {
            if (SETTINGS_VALIDATORS.notifPendingRequestBrowser(enabled)) {
                this.notifPendingRequestBrowser = enabled
            }
        },

        setWaTheme(theme) {
            if (SETTINGS_VALIDATORS.waTheme(theme)) {
                this.waTheme = theme
            }
        },

        setWaBrand(brand) {
            if (SETTINGS_VALIDATORS.waBrand(brand)) {
                this.waBrand = brand
            }
        },

        setUsageJsonFileEnabled(enabled) {
            if (SETTINGS_VALIDATORS.usageJsonFileEnabled(enabled)) {
                this.usageJsonFileEnabled = enabled
                // Mutually exclusive: disable dump mode
                if (enabled) this.usageDumpFileEnabled = false
            }
        },

        setUsageJsonFilePath(path) {
            if (SETTINGS_VALIDATORS.usageJsonFilePath(path)) {
                this.usageJsonFilePath = path
            }
        },

        setUsageDumpFileEnabled(enabled) {
            if (SETTINGS_VALIDATORS.usageDumpFileEnabled(enabled)) {
                this.usageDumpFileEnabled = enabled
                // Mutually exclusive: disable read mode
                if (enabled) this.usageJsonFileEnabled = false
            }
        },

        setUsageDumpFilePath(path) {
            if (SETTINGS_VALIDATORS.usageDumpFilePath(path)) {
                this.usageDumpFilePath = path
            }
        },

        /**
         * Apply synced settings received from the backend.
         * Merges with schema: validates each key, ignores unknown keys,
         * keeps current value if validation fails.
         * Sets a guard flag to prevent the synced-settings watcher from
         * sending these values back to the backend.
         * @param {Object} remoteSettings - Settings object from backend
         */
        applySyncedSettings(remoteSettings, version) {
            if (!remoteSettings || typeof remoteSettings !== 'object') return
            // Reject incoming settings with a version older than what we already have.
            // This closes the HTTP/WS ordering gap: if the WebSocket pushes version 5
            // before initSettings() applies the HTTP-fetched version 3, the stale
            // HTTP data is silently dropped.
            if (version !== undefined && version < _settingsVersion) return
            this._isApplyingRemoteSettings = true
            for (const key of SYNCED_SETTINGS_KEYS) {
                if (key in remoteSettings) {
                    const validator = SETTINGS_VALIDATORS[key]
                    if (!validator || validator(remoteSettings[key])) {
                        this[key] = remoteSettings[key]
                    }
                }
            }
            if (version !== undefined) {
                _settingsVersion = version
            }
            // Clear the guard AFTER Vue has flushed the watchers scheduled by the
            // mutations above. Vue's nextTick resolves after the current job flush,
            // so any watcher triggered by the mutations will still see the flag as
            // true and skip the outgoing send.
            nextTick(() => { this._isApplyingRemoteSettings = false })
        },

        _updateEffectiveColorScheme() {
            if (this.colorScheme === COLOR_SCHEME.SYSTEM) {
                this._effectiveColorScheme = window.matchMedia('(prefers-color-scheme: dark)').matches
                    ? COLOR_SCHEME.DARK
                    : COLOR_SCHEME.LIGHT
            } else {
                this._effectiveColorScheme = this.colorScheme
            }
        },
    },
})

/**
 * Claude session settings categories (live/idle/startup), loaded from backend.
 * Maps category name → array of setting field names.
 * Used to determine which settings can be applied live vs require process restart.
 */
let _claudeSettingsCategories = { live: [], idle: [], startup: [] }

/**
 * Get the Claude settings categories loaded from the backend.
 * @returns {{ live: string[], idle: string[], startup: string[] }}
 */
export function getClaudeSettingsCategories() {
    return _claudeSettingsCategories
}

/**
 * Classify changes between current and requested Claude session settings.
 * Returns which settings differ, grouped by category.
 * @param {Object} current - Current settings (from process or DB)
 * @param {Object} requested - Requested settings (from dropdowns)
 * @returns {{ live: string[], idle: string[], startup: string[] }}
 */
export function classifyClaudeSettingsChanges(current, requested) {
    const result = { live: [], idle: [], startup: [] }
    for (const [category, settings] of Object.entries(_claudeSettingsCategories)) {
        for (const setting of settings) {
            if (current[setting] !== requested[setting]) {
                result[category].push(setting)
            }
        }
    }
    return result
}

/**
 * Apply backend-provided default values for synced settings into SETTINGS_SCHEMA.
 * Must be called BEFORE initSettings() / useSettingsStore() so that loadSettings()
 * picks up the correct defaults when it runs for the first time.
 * Also applies the current synced settings values to the store.
 * @param {Object} defaultSettings - Default values from the backend
 * @param {Object} currentSettings - Current synced settings from the backend
 * @param {Object} claudeSettingsCategories - Claude settings categories from the backend
 * @param {boolean} devMode - Whether the backend is running in dev mode
 * @param {boolean} uvxMode - Whether the app was launched via uvx
 */
export function applyDefaultSettings(defaultSettings, currentSettings, claudeSettingsCategories, devMode, uvxMode, version) {
    if (defaultSettings && typeof defaultSettings === 'object') {
        Object.assign(SETTINGS_SCHEMA, defaultSettings)
    }
    if (claudeSettingsCategories && typeof claudeSettingsCategories === 'object') {
        _claudeSettingsCategories = claudeSettingsCategories
    }
    SETTINGS_SCHEMA._devMode = !!devMode
    SETTINGS_SCHEMA._uvxMode = !!uvxMode
    // Store current settings for applySyncedSettings() to use after store init
    _pendingSyncedSettings = currentSettings
    _pendingSettingsVersion = version
}

// Pending synced settings to apply once the store is initialized
let _pendingSyncedSettings = null

// Current settings version from backend (for optimistic concurrency).
// Module-level (not in store state) to avoid unnecessary reactivity.
let _settingsVersion = 0
let _pendingSettingsVersion = undefined

/**
 * Initialize settings store: apply initial values and set up watchers.
 * Call this once after Pinia is installed.
 * Handles:
 * - localStorage persistence (auto-save on changes)
 * - Color scheme changes
 * - Font size application
 * - Display mode changes (triggers visual items recompute)
 *
 * Note: Theme is applied early in main.js before CSS imports to prevent flash.
 * This function only sets up the watcher for subsequent theme changes.
 */
export function initSettings() {
    const store = useSettingsStore()

    // Apply synced settings fetched from the API before mount
    if (_pendingSyncedSettings) {
        store.applySyncedSettings(_pendingSyncedSettings, _pendingSettingsVersion)
        _pendingSyncedSettings = null
        _pendingSettingsVersion = undefined
    }

    // Apply initial font size (theme is already applied in main.js)
    document.documentElement.style.fontSize = `${store.fontSize}px`

    // Watch all state changes and save to localStorage
    // Note: _effectiveColorScheme is excluded as it's computed at runtime
    watch(
        () => ({
            displayMode: store.displayMode,
            fontSize: store.fontSize,
            colorScheme: store.colorScheme,
            sessionTimeFormat: store.sessionTimeFormat,
            titleGenerationEnabled: store.titleGenerationEnabled,
            titleAutoApply: store.titleAutoApply,
            titleSystemPrompt: store.titleSystemPrompt,
            showCosts: store.showCosts,
            extraUsageOnlyWhenNeeded: store.extraUsageOnlyWhenNeeded,
            maxCachedSessions: store.maxCachedSessions,
            autoUnpinOnArchive: store.autoUnpinOnArchive,
            terminalUseTmux: store.terminalUseTmux,
            showDiffs: store.showDiffs,
            toolDiffWordWrap: store.toolDiffWordWrap,
            toolDiffSideBySide: store.toolDiffSideBySide,
            diffSideBySide: store.diffSideBySide,
            editorWordWrap: store.editorWordWrap,
            compactSessionList: store.compactSessionList,
            showArchivedSessions: store.showArchivedSessions,
            showArchivedProjects: store.showArchivedProjects,
            showArchivedWorkspaces: store.showArchivedWorkspaces,
            defaultPermissionMode: store.defaultPermissionMode,
            defaultModel: store.defaultModel,
            defaultEffort: store.defaultEffort,
            defaultThinking: store.defaultThinking,
            defaultClaudeInChrome: store.defaultClaudeInChrome,
            defaultContextMax: store.defaultContextMax,
            notifUserTurnSound: store.notifUserTurnSound,
            notifUserTurnBrowser: store.notifUserTurnBrowser,
            notifPendingRequestSound: store.notifPendingRequestSound,
            notifPendingRequestBrowser: store.notifPendingRequestBrowser,
            waTheme: store.waTheme,
            waBrand: store.waBrand,
        }),
        (newSettings) => {
            saveSettings(newSettings)
        },
        { deep: true }
    )

    // Watch for color scheme changes
    watch(() => store.colorScheme, (mode) => {
        setColorSchemeOnDom(mode)
        store._updateEffectiveColorScheme()
    })

    // Detect touch device once at startup (primary input has no hover support)
    store._isTouchDevice = window.matchMedia('(hover: none)').matches
    // Detect macOS once at startup (for platform-appropriate key names)
    store._isMac = navigator.platform?.startsWith('Mac') || navigator.userAgent?.includes('Macintosh')

    // Initialize effective color scheme and listen for system preference changes
    store._updateEffectiveColorScheme()
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        store._updateEffectiveColorScheme()
    })

    // Watch for WA theme/palette/brand changes
    watch(() => store.waTheme, (theme) => { if (theme) setWaTheme(theme) })
    watch(() => store.waBrand, (brand) => { if (brand) setWaBrand(brand) })

    // Watch for font size changes
    watch(() => store.fontSize, (size) => {
        document.documentElement.style.fontSize = `${size}px`
    })

    // Watch synced settings and send to backend when changed by the user.
    // The guard flag (_isApplyingRemoteSettings) prevents re-sending when
    // changes come from the backend via WebSocket.
    // Lazy import of useWebSocket avoids circular dependency (settings.js ↔ useWebSocket.js).
    watch(
        () => {
            const synced = {}
            for (const key of SYNCED_SETTINGS_KEYS) {
                synced[key] = store[key]
            }
            return synced
        },
        async (newSynced) => {
            if (store._isApplyingRemoteSettings) return
            const { sendSyncedSettings } = await import('../composables/useWebSocket')
            sendSyncedSettings(newSynced, _settingsVersion)
        },
        { deep: true }
    )

    // Watch for display mode changes
    // Recompute all visual items when display mode changes
    watch(
        () => store.getDisplayMode,
        async () => {
            // Lazy import to avoid circular dependency (settings.js ↔ data.js)
            const { useDataStore } = await import('./data')
            const dataStore = useDataStore()
            dataStore.recomputeAllVisualItems()
        }
    )
}

// Pinia HMR support: allows Vite to hot-replace the store definition
// without propagating the update to importers (like main.js), which would
// cause a full page reload.
if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useSettingsStore, import.meta.hot))
}
