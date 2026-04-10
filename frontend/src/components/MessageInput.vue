<script setup>
// MessageInput.vue - Text input for sending messages to Claude
import { ref, computed, watch, nextTick, useId } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useDataStore } from '../stores/data'
import { useSettingsStore, classifyClaudeSettingsChanges } from '../stores/settings'
import { sendWsMessage, notifyUserDraftUpdated } from '../composables/useWebSocket'
import { isSupportedMimeType, MAX_FILE_SIZE, SUPPORTED_IMAGE_TYPES, draftMediaToMediaItem } from '../utils/fileUtils'
import { toast } from '../composables/useToast'
import { vPopoverFocusFix } from '../directives/vPopoverFocusFix'
import { PERMISSION_MODE, PERMISSION_MODE_LABELS, PERMISSION_MODE_DESCRIPTIONS, MODEL, MODEL_LABELS, EFFORT, EFFORT_LABELS, EFFORT_DISPLAY_LABELS, THINKING_LABELS, THINKING_DISPLAY_LABELS, CLAUDE_IN_CHROME_LABELS, CLAUDE_IN_CHROME_DISPLAY_LABELS, CONTEXT_MAX, CONTEXT_MAX_LABELS } from '../constants'
import { useCodeCommentsStore, formatAllComments } from '../stores/codeComments'
import { getParsedContent } from '../utils/parsedContent'
import MediaThumbnailGroup from './MediaThumbnailGroup.vue'
import AppTooltip from './AppTooltip.vue'
import FilePickerPopup from './FilePickerPopup.vue'
import SlashCommandPickerPopup from './SlashCommandPickerPopup.vue'
import MessageHistoryPickerPopup from './MessageHistoryPickerPopup.vue'
import MessageSnippetsBar from './MessageSnippetsBar.vue'
import MessageSnippetsDialog from './MessageSnippetsDialog.vue'
import { useMessageSnippetsStore } from '../stores/messageSnippets'
import { useWorkspacesStore } from '../stores/workspaces'
import { getUnavailablePlaceholders, resolveSnippetText } from '../utils/snippetPlaceholders'

const props = defineProps({
    sessionId: {
        type: String,
        required: true
    },
    projectId: {
        type: String,
        required: true
    }
})

const router = useRouter()
const route = useRoute()
const store = useDataStore()
const settingsStore = useSettingsStore()
const codeCommentsStore = useCodeCommentsStore()

// Detect "All Projects" mode from route name
const isAllProjectsMode = computed(() => route.name?.startsWith('projects-'))

const emit = defineEmits(['needs-title'])

// Get session data to check if it's a draft
const session = computed(() => store.getSession(props.sessionId))
const isDraft = computed(() => session.value?.draft === true)

// Local state for the textarea
const messageText = ref('')
const textareaRef = ref(null)
const fileInputRef = ref(null)
const attachButtonId = useId()
const settingsButtonId = useId()
const textareaAnchorId = useId()

// Message snippets dialog
const messageSnippetsDialogRef = ref(null)

// File picker popup state (@ mention)
const filePickerRef = ref(null)
const atCursorPosition = ref(null)  // cursor position right after the '@' character
const fileMirroredLength = ref(0)   // length of filter text mirrored into textarea after '@'

// Slash command picker popup state (/ at start)
const slashPickerRef = ref(null)
const slashCursorPosition = ref(null)  // cursor position right after the '/' character
const slashMirroredLength = ref(0)     // length of filter text mirrored into textarea after '/'

// Message history picker popup state (! at start, or PageUp on first line)
const historyPickerRef = ref(null)
const histCursorPosition = ref(null)   // cursor position right after the '!' character (bang mode only)
const histMirroredLength = ref(0)      // length of filter text mirrored into textarea after '!' (bang mode only)
const histTriggerMode = ref(null)      // 'bang' (! trigger) or 'pageup' (PageUp on first line)
const histInsertPosition = ref(null)   // cursor position for insertion (pageup mode only)

// Extract the text from the optimistic user message (if any) to pass to the history picker
const optimisticMessageText = computed(() => {
    const optimistic = store.localState.optimisticMessages[props.sessionId]
    if (!optimistic) return null
    const parsed = getParsedContent(optimistic)
    if (!parsed?.message?.content) return null
    const content = parsed.message.content
    // Content is either a string or an array of content blocks
    if (typeof content === 'string') return content.trim() || null
    if (Array.isArray(content)) {
        const textBlock = content.findLast(block => block.type === 'text')
        return textBlock?.text?.trim() || null
    }
    return null
})

// Attachments for this session
const attachments = computed(() => store.getAttachments(props.sessionId))
const attachmentCount = computed(() => store.getAttachmentCount(props.sessionId))

// Temporary tooltip shown when new files are attached
const attachTooltipText = ref('')
const showAttachTooltip = ref(false)
let attachTooltipTimer = null

watch(attachmentCount, (newCount, oldCount) => {
    if (newCount > oldCount) {
        const added = newCount - oldCount
        clearTimeout(attachTooltipTimer)
        attachTooltipText.value = `${added} file${added > 1 ? 's' : ''} attached`
        showAttachTooltip.value = true
        attachTooltipTimer = setTimeout(() => {
            showAttachTooltip.value = false
        }, 2000)
    }
})

// Convert DraftMedia objects to normalized MediaItem format for the thumbnail group
const mediaItems = computed(() => attachments.value.map(a => draftMediaToMediaItem(a)))

// Sentinel value for the "use default" option in wa-select dropdowns.
// When selected, the corresponding ref is set to null (= follow global default).
const DEFAULT_SENTINEL = '__default__'

// Permission mode options for the dropdown
const permissionModeOptions = Object.values(PERMISSION_MODE).map(value => ({
    value,
    label: PERMISSION_MODE_LABELS[value],
    description: PERMISSION_MODE_DESCRIPTIONS[value],
}))

// Model options for the dropdown
const modelOptions = Object.values(MODEL).map(value => ({
    value,
    label: MODEL_LABELS[value],
}))

// Effort options for the dropdown
const effortOptions = Object.values(EFFORT).map(value => ({
    value,
    label: EFFORT_LABELS[value],
}))

// Thinking options for the dropdown (use string values for wa-select compatibility)
const thinkingOptions = [
    { value: 'true', label: THINKING_LABELS[true] },
    { value: 'false', label: THINKING_LABELS[false] },
]

// Claude in Chrome options for the dropdown (use string values for wa-select compatibility)
const claudeInChromeOptions = [
    { value: 'true', label: CLAUDE_IN_CHROME_LABELS[true] },
    { value: 'false', label: CLAUDE_IN_CHROME_LABELS[false] },
]

// Context max options for the dropdown (use string values for wa-select compatibility)
const contextMaxOptions = Object.values(CONTEXT_MAX).map(value => ({
    value: String(value),
    label: CONTEXT_MAX_LABELS[value],
}))

// Default labels for the "Default: xxx" option in each dropdown
const defaultModelLabel = computed(() => MODEL_LABELS[settingsStore.getDefaultModel])
const defaultContextMaxLabel = computed(() => CONTEXT_MAX_LABELS[settingsStore.getDefaultContextMax])
const defaultEffortLabel = computed(() => EFFORT_LABELS[settingsStore.getDefaultEffort])
const defaultThinkingLabel = computed(() => THINKING_LABELS[settingsStore.getDefaultThinking])
const defaultChromeLabel = computed(() => CLAUDE_IN_CHROME_LABELS[settingsStore.getDefaultClaudeInChrome])
const defaultPermissionLabel = computed(() => PERMISSION_MODE_LABELS[settingsStore.getDefaultPermissionMode])

// Whether any session setting is explicitly forced (non-null)
const anySettingForced = computed(() =>
    selectedPermissionMode.value !== null ||
    selectedModel.value !== null ||
    selectedEffort.value !== null ||
    selectedThinking.value !== null ||
    selectedClaudeInChrome.value !== null ||
    selectedContextMax.value !== null
)

// Reset all settings to defaults (null = follow global default)
function resetAllToDefaults() {
    selectedPermissionMode.value = null
    selectedModel.value = null
    selectedEffort.value = null
    selectedThinking.value = null
    selectedClaudeInChrome.value = null
    selectedContextMax.value = null
}

// Restore dropdowns to their active (saved) values, discarding unsaved changes

function restoreSettings() {
    selectedModel.value = activeModel.value
    selectedPermissionMode.value = activePermissionMode.value
    selectedEffort.value = activeEffort.value
    selectedThinking.value = activeThinking.value
    selectedClaudeInChrome.value = activeClaudeInChrome.value
    selectedContextMax.value = activeContextMax.value
}

// Summary parts for the settings button.
// Each entry is { text, forced } where forced=true means the effective value
// differs from the global default (and the setting is explicitly set, not null).
// Model is also marked forced when context_max is explicitly forced to a non-default value.
const settingsSummaryParts = computed(() => {
    const effectiveModel = selectedModel.value ?? settingsStore.getDefaultModel
    const effectiveContextMax = selectedContextMax.value ?? settingsStore.getDefaultContextMax
    const effectiveEffort = selectedEffort.value ?? settingsStore.getDefaultEffort
    const effectiveThinking = selectedThinking.value ?? settingsStore.getDefaultThinking
    const effectiveChrome = selectedClaudeInChrome.value ?? settingsStore.getDefaultClaudeInChrome
    const effectivePermission = selectedPermissionMode.value ?? settingsStore.getDefaultPermissionMode

    const modelLabel = MODEL_LABELS[effectiveModel]
    const modelDisplay = effectiveContextMax === CONTEXT_MAX.EXTENDED
        ? `${modelLabel}[1m]`
        : modelLabel
    // Model part is forced if model or context_max is explicitly set to a non-default value
    const modelForced = (selectedModel.value !== null && selectedModel.value !== settingsStore.getDefaultModel)
        || (selectedContextMax.value !== null && selectedContextMax.value !== settingsStore.getDefaultContextMax)

    return [
        { text: modelDisplay, forced: modelForced },
        { text: EFFORT_DISPLAY_LABELS[effectiveEffort], forced: selectedEffort.value !== null && selectedEffort.value !== settingsStore.getDefaultEffort },
        { text: THINKING_DISPLAY_LABELS[effectiveThinking], forced: selectedThinking.value !== null && selectedThinking.value !== settingsStore.getDefaultThinking },
        { text: CLAUDE_IN_CHROME_DISPLAY_LABELS[effectiveChrome], forced: selectedClaudeInChrome.value !== null && selectedClaudeInChrome.value !== settingsStore.getDefaultClaudeInChrome },
        { text: PERMISSION_MODE_LABELS[effectivePermission], forced: selectedPermissionMode.value !== null && selectedPermissionMode.value !== settingsStore.getDefaultPermissionMode },
    ]
})

// Selected settings for the current session.
// null = "use default" (follow global default), explicit value = "forced" for this session.
const selectedPermissionMode = ref(null)
const selectedModel = ref(null)
const selectedEffort = ref(null)
const selectedThinking = ref(null)
const selectedClaudeInChrome = ref(null)
const selectedContextMax = ref(null)

// Get process state for this session
const processState = computed(() => store.getProcessState(props.sessionId))

// Whether files are currently being processed (encoded/resized) for this session
const isProcessingFiles = computed(() => store.isProcessingAttachments(props.sessionId))

// Determine if input/button should be disabled
const isDisabled = computed(() => {
    if (!store.wsConnected) return true
    if (store.isInitialSyncInProgress) return true
    if (isProcessingFiles.value) return true
    const state = processState.value?.state
    return state === 'starting'
})

// All dropdowns disabled only during starting
const isStarting = computed(() => processState.value?.state === 'starting')

// Force 1M context when session usage exceeds 85% of the 200K window.
// Only applies when no process is active.
const isContextMaxForced = computed(() => {
    if (processIsActive.value) return false
    const sess = store.getSession(props.sessionId)
    if (!sess?.context_usage) return false
    return sess.context_usage > CONTEXT_MAX.DEFAULT * 0.85
})

// Button label based on process state and settings changes
const buttonLabel = computed(() => {
    const state = processState.value?.state
    if (state === 'starting') return 'Starting...'
    if (hasSettingsChanged.value && !messageText.value.trim()) return 'Apply settings'
    return 'Send'
})

// Button icon changes based on mode
const buttonIcon = computed(() => {
    if (hasSettingsChanged.value && !messageText.value.trim()) return 'arrows-rotate'
    return 'paper-plane'
})

// Placeholder text based on process state
const placeholderText = computed(() => {
    const state = processState.value?.state
    if (state === 'starting') {
        return 'Starting Claude process...'
    }
    if (state === 'assistant_turn') {
        return 'You can send a message now. Claude will receive it as soon as possible (while working or after). Note: it will not appear in the conversation history.'
    }
    const historyHint = isDraft.value
        ? ''
        : settingsStore.isTouchDevice
            ? ', ! = message history'
            : ', ! and PageUp = message history'
    let text = `Shortcuts: At start: / = commands${historyHint}; Anywhere: @ = file paths`
    if (!settingsStore.isTouchDevice) {
        const keys = settingsStore.isMac ? '⌘↵ or Ctrl↵' : 'Ctrl↵ or Meta↵'
        text += `, ${keys} to send`
    }
    return text
})

// Whether a process is actively running (not starting, not dead)
const processIsActive = computed(() => {
    const state = processState.value?.state
    return state === 'assistant_turn' || state === 'user_turn'
})

// Track the "active" values currently applied on the live SDK process (or from DB when no process).
// null means the setting uses the global default.
const activeModel = ref(null)
const activePermissionMode = ref(null)
const activeEffort = ref(null)
const activeThinking = ref(null)
const activeClaudeInChrome = ref(null)
const activeContextMax = ref(null)

// Detect whether the user has changed any dropdown from its reference value
const hasDropdownsChanged = computed(() =>
    selectedModel.value !== activeModel.value ||
    selectedPermissionMode.value !== activePermissionMode.value ||
    selectedEffort.value !== activeEffort.value ||
    selectedThinking.value !== activeThinking.value ||
    selectedClaudeInChrome.value !== activeClaudeInChrome.value ||
    selectedContextMax.value !== activeContextMax.value
)

// Whether any setting has changed from the active/DB value (used for button label)
const hasSettingsChanged = computed(() => hasDropdownsChanged.value)

// Resolve null → global default for a settings dict (so classify compares concrete values).
function resolveSettingsDefaults(settings) {
    return {
        permission_mode: settings.permission_mode ?? settingsStore.getDefaultPermissionMode,
        selected_model: settings.selected_model ?? settingsStore.getDefaultModel,
        effort: settings.effort ?? settingsStore.getDefaultEffort,
        thinking_enabled: settings.thinking_enabled ?? settingsStore.getDefaultThinking,
        claude_in_chrome: settings.claude_in_chrome ?? settingsStore.getDefaultClaudeInChrome,
        context_max: settings.context_max ?? settingsStore.getDefaultContextMax,
    }
}

// Warning message when startup settings changed on an active process (will cause stop/restart).
// Returns null if no warning needed. Compares concrete (resolved) values, not raw null vs explicit.
const startupSettingsWarning = computed(() => {
    const _processActive = processIsActive.value
    const _dropdownsChanged = hasDropdownsChanged.value
    if (!_processActive || !_dropdownsChanged) {
        console.debug('[startupWarning] early exit:', { processIsActive: _processActive, hasDropdownsChanged: _dropdownsChanged, processState: processState.value?.state, sessionId: props.sessionId })
        return null
    }

    const current = resolveSettingsDefaults({
        permission_mode: activePermissionMode.value,
        selected_model: activeModel.value,
        effort: activeEffort.value,
        thinking_enabled: activeThinking.value,
        claude_in_chrome: activeClaudeInChrome.value,
        context_max: activeContextMax.value,
    })
    const requested = resolveSettingsDefaults({
        permission_mode: selectedPermissionMode.value,
        selected_model: selectedModel.value,
        effort: selectedEffort.value,
        thinking_enabled: selectedThinking.value,
        claude_in_chrome: selectedClaudeInChrome.value,
        context_max: selectedContextMax.value,
    })
    const changes = classifyClaudeSettingsChanges(current, requested)
    if (!changes.startup.length) return null

    const state = processState.value?.state
    const hasCrons = processState.value?.active_crons?.length > 0
    const prefix = state === 'assistant_turn'
        ? 'Once Claude finishes its current work, the'
        : 'The'

    const hasText = messageText.value.trim()
    if (hasCrons) {
        const suffix = hasText
            ? ', after which your message will be sent.'
            : '.'
        return `${prefix} Claude Code process will be stopped to apply these settings, then resumed to restart the current cron jobs${suffix}`
    }
    const suffix = hasText
        ? 'Your message will be sent after the process restarts.'
        : 'Your next message will resume the session.'
    return `${prefix} Claude Code process will be stopped to apply these settings. ${suffix}`
})

// Sync all settings when session changes
watch(() => props.sessionId, (newId) => {
    const sess = store.getSession(newId)
    // Session DB values (null = default, explicit = forced)
    selectedPermissionMode.value = sess?.permission_mode ?? null
    selectedModel.value = sess?.selected_model ?? null
    selectedEffort.value = sess?.effort ?? null
    selectedThinking.value = sess?.thinking_enabled ?? null
    selectedClaudeInChrome.value = sess?.claude_in_chrome ?? null
    selectedContextMax.value = sess?.context_max ?? null
    // Initialize active values to match
    activePermissionMode.value = selectedPermissionMode.value
    activeModel.value = selectedModel.value
    activeEffort.value = selectedEffort.value
    activeThinking.value = selectedThinking.value
    activeClaudeInChrome.value = selectedClaudeInChrome.value
    activeContextMax.value = selectedContextMax.value
}, { immediate: true })

// When global defaults change and this session uses them (null setting),
// the display updates automatically via the default label computeds.
// No watcher needed — the computed that reads the default getter re-evaluates.

// React when session data arrives from backend (e.g., after save or watcher creates the row).
// Update active values to track what's in DB. Don't overwrite user's selection when process is active.
const SESSION_SETTING_FIELDS = ['permission_mode', 'selected_model', 'effort', 'thinking_enabled', 'claude_in_chrome', 'context_max']
const SELECTED_REFS = { permission_mode: selectedPermissionMode, selected_model: selectedModel, effort: selectedEffort, thinking_enabled: selectedThinking, claude_in_chrome: selectedClaudeInChrome, context_max: selectedContextMax }
const ACTIVE_REFS = { permission_mode: activePermissionMode, selected_model: activeModel, effort: activeEffort, thinking_enabled: activeThinking, claude_in_chrome: activeClaudeInChrome, context_max: activeContextMax }

for (const field of SESSION_SETTING_FIELDS) {
    watch(
        () => store.getSession(props.sessionId)?.[field],
        (newValue) => {
            if (newValue === undefined) return
            ACTIVE_REFS[field].value = newValue
            if (!processIsActive.value) {
                SELECTED_REFS[field].value = newValue
            }
        }
    )
}

// Force 1M context when context_usage crosses the 85% threshold of 200K.
watch(isContextMaxForced, (forced) => {
    if (forced) {
        selectedContextMax.value = CONTEXT_MAX.EXTENDED
        activeContextMax.value = CONTEXT_MAX.EXTENDED
    }
})

// Restore draft message when session changes
watch(() => props.sessionId, async (newId) => {
    const draft = store.getDraftMessage(newId)
    messageText.value = draft?.message || ''
    // Adjust textarea height after the DOM updates with restored content
    await nextTick()
    if (textareaRef.value?.updateComplete) {
        await textareaRef.value.updateComplete
    }
    adjustTextareaHeight()
}, { immediate: true })

// Also restore draft when it arrives after hydration (initial page load)
// This handles the race condition where the component mounts before IndexedDB is loaded
watch(
    () => store.getDraftMessage(props.sessionId),
    async (draft) => {
        // Only restore if textarea is still empty (don't overwrite user typing)
        if (!messageText.value && draft?.message) {
            messageText.value = draft.message
            // Adjust textarea height after the DOM updates with restored content
            await nextTick()
            if (textareaRef.value?.updateComplete) {
                await textareaRef.value.updateComplete
            }
            adjustTextareaHeight()
        }
    }
)

// Save draft message on each keystroke (debounced in store)
watch(messageText, (newText) => {
    store.setDraftMessage(props.sessionId, newText)
})

// Autofocus textarea for draft sessions (only once)
const hasAutoFocused = ref(false)

// Watch both isDraft and textareaRef - focus when both are ready
watch([isDraft, textareaRef], async ([isDraftSession, textarea]) => {
    if (isDraftSession && !hasAutoFocused.value && textarea) {
        hasAutoFocused.value = true
        // Wait for Vue's next tick
        await nextTick()
        // Wait for the Web Component to be fully rendered (Lit's updateComplete)
        if (textarea.updateComplete) {
            await textarea.updateComplete
        }
        // Wait until the textarea is visible (offsetParent !== null).
        // When creating a new session from an empty state (no session was selected),
        // the parent components (SessionView, SessionItemsList) are mounted for the first time,
        // and the textarea may not be visible yet. An element with offsetParent === null
        // cannot receive focus.
        const maxAttempts = 20
        for (let i = 0; i < maxAttempts; i++) {
            if (textarea.offsetParent !== null) {
                break
            }
            await new Promise(resolve => requestAnimationFrame(resolve))
        }
        adjustTextareaHeight()
        textarea.focus()
    }
}, { immediate: true })

/**
 * Adjust the textarea height to fit its content.
 * Accesses the internal <textarea> inside the wa-textarea shadow DOM
 * to perform a single synchronous height reset + scrollHeight read.
 * Unlike wa-textarea's built-in resize="auto", this avoids the
 * ResizeObserver feedback loop that causes 1px jitter.
 */
function adjustTextareaHeight() {
    const textarea = textareaRef.value?.shadowRoot?.querySelector('textarea')
    if (!textarea) return
    // Reset to auto to measure natural scrollHeight
    textarea.style.height = 'auto'
    // Only set an explicit height if content exceeds the natural rows height.
    // When scrollHeight <= the natural height (determined by the rows="3" attribute),
    // leaving height as "auto" lets the browser use the rows attribute as the floor.
    if (textarea.scrollHeight > textarea.clientHeight) {
        textarea.style.height = `${textarea.scrollHeight}px`
    }
}

/**
 * Handle textarea input event.
 * Detects '@' insertion to trigger the file picker popup.
 * Detects '/' at position 0 to trigger the slash command picker popup.
 * Also notifies the server that the user is actively drafting (debounced).
 */
function onInput(event) {
    const newText = event.target.value
    const oldText = messageText.value

    // Detect single character insertion
    if (newText.length === oldText.length + 1) {
        const inner = textareaRef.value?.shadowRoot?.querySelector('textarea')
        const cursorPos = inner?.selectionStart

        // Detect '@' to trigger file picker (only at start of text or after whitespace)
        if (!filePickerRef.value?.isOpen && cursorPos > 0 && newText[cursorPos - 1] === '@'
            && (cursorPos === 1 || /\s/.test(newText[cursorPos - 2]))) {
            atCursorPosition.value = cursorPos  // right after the '@'
            fileMirroredLength.value = 0
            nextTick(() => filePickerRef.value?.open())
        }

        // Detect '/' at position 0 (first character of the message) to trigger slash command picker
        if (!slashPickerRef.value?.isOpen && cursorPos === 1 && newText[0] === '/') {
            slashCursorPosition.value = cursorPos  // right after the '/'
            slashMirroredLength.value = 0
            nextTick(() => slashPickerRef.value?.open())
        }

        // Detect '!' at position 0 (first character of the message) to trigger message history picker
        // Skip on draft sessions — no message history to show
        if (!isDraft.value && !historyPickerRef.value?.isOpen && cursorPos === 1 && newText[0] === '!') {
            histTriggerMode.value = 'bang'
            histCursorPosition.value = cursorPos  // right after the '!'
            histMirroredLength.value = 0
            histInsertPosition.value = null
            nextTick(() => historyPickerRef.value?.open())
        }
    }

    messageText.value = newText
    adjustTextareaHeight()
    // Notify server that user is actively preparing a message (debounced)
    // This prevents auto-stop of the process due to inactivity timeout
    notifyUserDraftUpdated(props.sessionId)
}

/**
 * Update textarea content programmatically (without triggering input events).
 * Sets the value on the Vue reactive ref, the wa-textarea web component,
 * and the inner shadow DOM textarea.
 */
function updateTextareaContent(newText) {
    messageText.value = newText
    if (textareaRef.value) {
        textareaRef.value.value = newText
        const inner = textareaRef.value.shadowRoot?.querySelector('textarea')
        if (inner) {
            inner.value = newText
        }
    }
    adjustTextareaHeight()
}

/**
 * Mirror popup filter text into the textarea at the given cursor position.
 * Replaces the previously mirrored text (tracked by mirroredLengthRef) with
 * the new filter text, keeping surrounding content intact.
 */
function mirrorFilterToTextarea(pos, mirroredLengthRef, filterText) {
    if (pos == null) return

    const currentText = messageText.value
    const before = currentText.slice(0, pos)
    const after = currentText.slice(pos + mirroredLengthRef.value)
    const newText = before + filterText + after

    mirroredLengthRef.value = filterText.length
    updateTextareaContent(newText)
}

/**
 * Handle filter text changes from the file picker popup.
 * Mirrors the typed filter text into the textarea right after the '@'.
 */
function onFilePickerFilterChange(filterText) {
    mirrorFilterToTextarea(atCursorPosition.value, fileMirroredLength, filterText)
}

/**
 * Handle filter text changes from the slash command picker popup.
 * Mirrors the typed filter text into the textarea right after the '/'.
 */
function onSlashPickerFilterChange(filterText) {
    mirrorFilterToTextarea(slashCursorPosition.value, slashMirroredLength, filterText)
}

/**
 * Handle file selection from the file picker popup.
 * Inserts the relative path right after the '@' character at the recorded position.
 */
async function onFilePickerSelect(relativePath) {
    const pos = atCursorPosition.value
    if (pos != null && pos <= messageText.value.length) {
        const before = messageText.value.slice(0, pos)
        // Skip the mirrored filter text that was transparently inserted
        const after = messageText.value.slice(pos + fileMirroredLength.value)
        // Add a trailing space unless the text after already starts with one
        const space = after.startsWith(' ') ? '' : ' '
        const newText = before + relativePath + space + after
        messageText.value = newText

        // Force update the web component and inner textarea
        if (textareaRef.value) {
            textareaRef.value.value = newText
            const inner = textareaRef.value.shadowRoot?.querySelector('textarea')
            if (inner) {
                inner.value = newText
                const newPos = pos + relativePath.length + space.length
                inner.setSelectionRange(newPos, newPos)
            }
        }
    }

    atCursorPosition.value = null
    fileMirroredLength.value = 0
    await nextTick()
    textareaRef.value?.focus()
    adjustTextareaHeight()
}

/**
 * Handle file picker popup close (without selection).
 * Returns focus to the textarea and positions the cursor after the
 * trigger character + any filter text that was mirrored.
 */
function onFilePickerClose() {
    const pos = atCursorPosition.value
    const mirrorLen = fileMirroredLength.value
    atCursorPosition.value = null
    fileMirroredLength.value = 0

    textareaRef.value?.focus()
    if (pos != null) {
        const inner = textareaRef.value?.shadowRoot?.querySelector('textarea')
        if (inner) {
            const cursorTarget = pos + mirrorLen
            inner.setSelectionRange(cursorTarget, cursorTarget)
        }
    }
}

/**
 * Handle slash command selection from the slash command picker popup.
 * Replaces the entire textarea content with the selected command text.
 */
async function onSlashCommandSelect(commandText) {
    slashCursorPosition.value = null
    slashMirroredLength.value = 0
    messageText.value = commandText

    // Force update the web component and inner textarea
    if (textareaRef.value) {
        textareaRef.value.value = commandText
        const inner = textareaRef.value.shadowRoot?.querySelector('textarea')
        if (inner) {
            inner.value = commandText
            const newPos = commandText.length
            inner.setSelectionRange(newPos, newPos)
        }
    }

    await nextTick()
    textareaRef.value?.focus()
    adjustTextareaHeight()
}

/**
 * Handle slash command picker popup close (without selection).
 * Returns focus to the textarea and positions the cursor after the
 * trigger character + any filter text that was mirrored.
 */
function onSlashCommandPickerClose() {
    const pos = slashCursorPosition.value
    const mirrorLen = slashMirroredLength.value
    slashCursorPosition.value = null
    slashMirroredLength.value = 0

    textareaRef.value?.focus()
    if (pos != null) {
        const inner = textareaRef.value?.shadowRoot?.querySelector('textarea')
        if (inner) {
            const cursorTarget = pos + mirrorLen
            inner.setSelectionRange(cursorTarget, cursorTarget)
        }
    }
}

/**
 * Handle filter text changes from the message history picker popup.
 * In bang mode, mirrors the typed filter text into the textarea right after the '!'.
 * In pageup mode, no mirroring is needed.
 */
function onHistoryPickerFilterChange(filterText) {
    if (histTriggerMode.value === 'bang') {
        mirrorFilterToTextarea(histCursorPosition.value, histMirroredLength, filterText)
    }
}

/**
 * Handle message selection from the message history picker popup.
 *
 * Bang mode ('!'): Replaces the '!' trigger character and any mirrored filter
 * text with the selected message text. Preserves surrounding textarea content.
 *
 * PageUp mode: Inserts the selected message text at the cursor position
 * where PageUp was pressed. No trigger character to remove.
 */
async function onHistoryMessageSelect(selectedText) {
    const mode = histTriggerMode.value
    const triggerPos = histCursorPosition.value
    const mirrorLen = histMirroredLength.value
    const insertPos = histInsertPosition.value

    // Reset all state
    histTriggerMode.value = null
    histCursorPosition.value = null
    histMirroredLength.value = 0
    histInsertPosition.value = null

    if (mode === 'bang' && triggerPos != null) {
        const currentContent = messageText.value
        // triggerPos is right after '!', so the '!' is at triggerPos-1
        const before = currentContent.slice(0, triggerPos - 1)
        const after = currentContent.slice(triggerPos + mirrorLen)
        const newText = before + selectedText + after
        const newCursorPos = before.length + selectedText.length

        updateTextareaContent(newText)
        await nextTick()

        const inner = textareaRef.value?.shadowRoot?.querySelector('textarea')
        if (inner) {
            inner.setSelectionRange(newCursorPos, newCursorPos)
        }
    } else if (mode === 'pageup' && insertPos != null) {
        const currentContent = messageText.value
        const before = currentContent.slice(0, insertPos)
        const after = currentContent.slice(insertPos)
        const newText = before + selectedText + after
        const newCursorPos = before.length + selectedText.length

        updateTextareaContent(newText)
        await nextTick()

        const inner = textareaRef.value?.shadowRoot?.querySelector('textarea')
        if (inner) {
            inner.setSelectionRange(newCursorPos, newCursorPos)
        }
    }

    await nextTick()
    textareaRef.value?.focus()
    adjustTextareaHeight()
}

/**
 * Handle message history picker popup close (without selection).
 * Returns focus to the textarea and restores the cursor position.
 *
 * Bang mode: positions cursor after '!' + any mirrored filter text.
 * PageUp mode: restores cursor to original position.
 */
function onHistoryPickerClose() {
    const mode = histTriggerMode.value
    const pos = histCursorPosition.value
    const mirrorLen = histMirroredLength.value
    const insertPos = histInsertPosition.value

    // Reset all state
    histTriggerMode.value = null
    histCursorPosition.value = null
    histMirroredLength.value = 0
    histInsertPosition.value = null

    textareaRef.value?.focus()
    const inner = textareaRef.value?.shadowRoot?.querySelector('textarea')
    if (inner) {
        if (mode === 'bang' && pos != null) {
            const cursorTarget = pos + mirrorLen
            inner.setSelectionRange(cursorTarget, cursorTarget)
        } else if (mode === 'pageup' && insertPos != null) {
            inner.setSelectionRange(insertPos, insertPos)
        }
    }
}

/**
 * Handle keyboard shortcuts in textarea.
 * Cmd/Ctrl+Enter submits the message.
 * PageUp on first line opens message history picker.
 */
function onKeydown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSend()
        return
    }

    // PageUp on the first line → open message history picker
    // Skip on draft sessions — no message history to show
    if (!isDraft.value && event.key === 'PageUp' && !historyPickerRef.value?.isOpen) {
        const inner = textareaRef.value?.shadowRoot?.querySelector('textarea')
        if (inner) {
            const cursorPos = inner.selectionStart
            const textBefore = inner.value.slice(0, cursorPos)
            // Cursor is on the first line if there's no newline before it
            if (!textBefore.includes('\n')) {
                event.preventDefault()
                histTriggerMode.value = 'pageup'
                histInsertPosition.value = cursorPos
                histCursorPosition.value = null
                histMirroredLength.value = 0
                nextTick(() => historyPickerRef.value?.open())
            }
        }
    }
}

/**
 * Handle paste event to capture images from clipboard.
 * Only processes image files from clipboard.
 */
async function onPaste(event) {
    const items = event.clipboardData?.items
    if (!items) return

    for (const item of items) {
        // Only handle image files from clipboard
        if (item.kind === 'file' && SUPPORTED_IMAGE_TYPES.includes(item.type)) {
            const file = item.getAsFile()
            if (file) {
                event.preventDefault()
                await processFile(file)
                return // Process only the first image
            }
        }
    }
}

/**
 * Process and add a file as an attachment.
 */
async function processFile(file) {
    // Validate MIME type
    if (!isSupportedMimeType(file.type)) {
        const extension = file.name.split('.').pop()?.toLowerCase() || 'unknown'
        toast.error(`Unsupported file type: .${extension}`, {
            title: 'Cannot attach file'
        })
        return
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1)
        toast.error(`File too large: ${sizeMB} MB (max 5 MB)`, {
            title: 'Cannot attach file'
        })
        return
    }

    try {
        await store.addAttachment(props.sessionId, file)
        // Notify server that user is actively preparing a message
        notifyUserDraftUpdated(props.sessionId)
    } catch (error) {
        toast.error(error.message || 'Failed to process file', {
            title: 'Cannot attach file'
        })
    }
}

/**
 * Open the file picker dialog.
 */
function openFilePicker() {
    fileInputRef.value?.click()
}

/**
 * Handle file selection from the file picker.
 */
async function onFileSelected(event) {
    const files = event.target.files
    if (!files) return

    for (const file of files) {
        await processFile(file)
    }

    // Reset input so the same file can be selected again
    event.target.value = ''
}

/**
 * Remove an attachment by index (from MediaThumbnailGroup).
 * Translates the index back to the DraftMedia id for the store.
 */
function removeAttachmentByIndex(index) {
    const attachment = attachments.value[index]
    if (attachment) {
        store.removeAttachment(props.sessionId, attachment.id)
    }
}

/**
 * Remove all attachments.
 */
function removeAllAttachments() {
    store.clearAttachmentsForSession(props.sessionId)
}

/**
 * Send the message via WebSocket.
 * Backend handles both new and existing sessions with the same message type.
 * For draft sessions with a custom title, include the title in the message.
 * For draft sessions without a title, send the message AND open the rename dialog.
 *
 * Also handles settings-only updates: when text is empty but model/permission
 * mode has changed on an active process, sends a payload with empty text so
 * the backend applies the settings via SDK methods without sending a query.
 */
async function handleSend() {
    const text = messageText.value.trim()
    const isSettingsOnlyUpdate = !text && hasSettingsChanged.value

    // Need either text or settings change to proceed
    if ((!text && !isSettingsOnlyUpdate) || isDisabled.value) return

    // Build the message payload
    const payload = {
        type: 'send_message',
        session_id: props.sessionId,
        project_id: props.projectId,
        text: text,
        // Settings: null = use global default, explicit value = forced for this session
        permission_mode: selectedPermissionMode.value,
        selected_model: selectedModel.value,
        effort: selectedEffort.value,
        thinking_enabled: selectedThinking.value,
        claude_in_chrome: selectedClaudeInChrome.value,
        context_max: selectedContextMax.value,
    }

    // For draft sessions with a title, include it
    if (isDraft.value && session.value?.title) {
        payload.title = session.value.title
    }

    // For draft sessions without a title, open the rename dialog (non-blocking)
    // The message is still sent, allowing the agent to start working
    if (isDraft.value && !session.value?.title) {
        emit('needs-title')
    }

    // Include attachments in SDK format if any
    if (attachmentCount.value > 0) {
        const { images, documents } = store.getAttachmentsForSdk(props.sessionId)
        if (images.length > 0) {
            payload.images = images
        }
        if (documents.length > 0) {
            payload.documents = documents
        }
    }

    const success = sendWsMessage(payload)

    if (success) {
        // Sync active values to match what was just sent to the backend.
        // This makes the "Update..." button disappear immediately.
        activeModel.value = selectedModel.value
        activePermissionMode.value = selectedPermissionMode.value
        activeEffort.value = selectedEffort.value
        activeThinking.value = selectedThinking.value
        activeClaudeInChrome.value = selectedClaudeInChrome.value
        activeContextMax.value = selectedContextMax.value

        // For settings-only updates, nothing else to clean up
        if (isSettingsOnlyUpdate) return

        // Show optimistic user message immediately (only when not in assistant_turn,
        // because during assistant_turn the message is queued and the user_message
        // won't arrive until later)
        const state = processState.value?.state
        if (state !== 'assistant_turn') {
            const attachments = (payload.images || payload.documents)
                ? { images: payload.images, documents: payload.documents }
                : undefined
            store.setOptimisticMessage(props.sessionId, text, attachments)

            // Set optimistic STARTING state if no process is running yet.
            // The backend broadcasts STARTING before spawning the subprocess,
            // but the SDK connect() blocks the asyncio event loop, so the
            // WebSocket message only arrives after the subprocess is ready
            // (~2-4 seconds later, alongside ASSISTANT_TURN). This optimistic
            // state gives immediate visual feedback to the user.
            if (!state) {
                store.setProcessState(props.sessionId, props.projectId, 'starting')
            }
        }

        // Clear draft message from store (and IndexedDB)
        store.clearDraftMessage(props.sessionId)

        // Clear attachments from store and IndexedDB
        if (attachmentCount.value > 0) {
            await store.clearAttachmentsForSession(props.sessionId)
        }

        // Clear draft session from IndexedDB only (if this was a draft session)
        // Keep in store so session stays visible until backend confirms with session_updated
        if (isDraft.value) {
            store.deleteDraftSession(props.sessionId, { keepInStore: true })
        }

        // Clear the textarea on successful send.
        // Force-clear the Web Component's value property directly: Vue may skip
        // re-pushing "" via :value.prop if it already pushed "" on a previous send
        // (Vue's template binding deduplicates identical prop values).
        messageText.value = ''
        if (textareaRef.value) {
            // Force-clear both the Web Component property and its internal <textarea>.
            // Setting wa.value alone may be ignored by the Lit setter's dedup check
            // (if _value is already ""), and even when accepted, the Lit re-render
            // with live() can be skipped if Vue's binding already pushed the same value.
            // Directly clearing the inner textarea ensures the DOM is always updated.
            textareaRef.value.value = ''
            const inner = textareaRef.value.shadowRoot?.querySelector('textarea')
            if (inner) inner.value = ''
            await nextTick()
            adjustTextareaHeight()
        }
    }
}

/**
 * Cancel the draft session and navigate back to project list.
 * Navigates to 'projects-all' if in All Projects mode, otherwise to 'project'.
 */
function handleCancel() {
    // Clear draft message from store and IndexedDB
    store.clearDraftMessage(props.sessionId)
    store.deleteDraftSession(props.sessionId)

    if (isAllProjectsMode.value) {
        router.push({ name: 'projects-all', query: route.query.workspace ? { workspace: route.query.workspace } : {} })
    } else {
        router.push({ name: 'project', params: { projectId: props.projectId } })
    }
}

/**
 * Reset the form to its initial state: clear textarea text and
 * restore dropdowns to their active (server-side) values.
 */
async function handleReset() {
    // Clear text if any
    if (messageText.value) {
        messageText.value = ''
        store.clearDraftMessage(props.sessionId)
        if (textareaRef.value) {
            textareaRef.value.value = ''
            const inner = textareaRef.value.shadowRoot?.querySelector('textarea')
            if (inner) inner.value = ''
            await nextTick()
            adjustTextareaHeight()
        }
    }
    // Reset dropdowns to their reference values (active process or DB, including null)
    if (hasDropdownsChanged.value) {
        restoreSettings()
    }
}

/**
 * Insert text at the current cursor position in the textarea.
 * If no cursor position is available, appends to the end.
 * Focuses the textarea and positions the cursor after the inserted text.
 */
function insertTextAtCursor(text) {
    const inner = textareaRef.value?.shadowRoot?.querySelector('textarea')
    const current = messageText.value
    const pos = inner?.selectionStart ?? current.length

    const before = current.slice(0, pos)
    const after = current.slice(inner?.selectionEnd ?? pos)
    const newText = before + text + after

    updateTextareaContent(newText)

    // Position cursor after the inserted text and focus
    const newPos = pos + text.length
    nextTick(() => {
        const innerEl = textareaRef.value?.shadowRoot?.querySelector('textarea')
        if (innerEl) {
            innerEl.setSelectionRange(newPos, newPos)
        }
        textareaRef.value?.focus()
    })
}

// ─── Code comments: "Add all comments to message" button ─────────────────────

const sessionCommentsWithContent = computed(() =>
    codeCommentsStore.getCommentsBySession(props.projectId, props.sessionId)
        .filter(c => c.content.trim())
)

const commentsWithContentCount = computed(() => sessionCommentsWithContent.value.length)

function clearAllSessionComments() {
    codeCommentsStore.removeAllSessionComments(props.projectId, props.sessionId)
}

function addAllCommentsToMessage() {
    const comments = sessionCommentsWithContent.value
    if (comments.length === 0) return
    insertTextAtCursor(formatAllComments(comments) + '\n')
    codeCommentsStore.removeAllSessionComments(props.projectId, props.sessionId)
}

// ── Message snippets ────────────────────────────────────────────────
const messageSnippetsStore = useMessageSnippetsStore()

/** Placeholder resolution context (same shape as terminal uses). */
const placeholderContext = computed(() => {
    const s = session.value
    const pid = props.projectId
    const project = pid ? store.getProject(pid) : null
    const projectName = pid ? store.getProjectDisplayName(pid) : null
    return { session: s, project, projectName }
})

/** Workspace IDs for snippet display: active workspace, or all workspaces containing this project. */
const snippetWorkspaceIds = computed(() => {
    const wsId = route.query.workspace
    if (wsId) return [wsId]
    if (!props.projectId) return []
    const workspacesStore = useWorkspacesStore()
    return workspacesStore.getWorkspacesForProject(props.projectId).map(ws => ws.id)
})

/** Snippets for this project, enriched with _disabled / _disabledReason for unresolvable placeholders. */
const snippetsForProject = computed(() => {
    const raw = props.projectId ? messageSnippetsStore.getSnippetsForProject(props.projectId, snippetWorkspaceIds.value) : []
    const ctx = placeholderContext.value

    return raw.map(snippet => {
        const placeholders = snippet.placeholders || []
        if (placeholders.length === 0) return snippet
        const unavailable = getUnavailablePlaceholders(placeholders, ctx)
        if (unavailable.length === 0) return snippet
        return {
            ...snippet,
            _disabled: true,
            _disabledReason: `Not available: ${unavailable.map(p => p.label).join(', ')}`,
        }
    })
})

function handleSnippetPress(snippet) {
    const placeholders = snippet.placeholders || []
    const resolved = resolveSnippetText(snippet.text, placeholders, placeholderContext.value)
    insertTextAtCursor(resolved)
}

function handleSnippetDisabledPress(snippet) {
    toast(snippet._disabledReason || 'Some placeholders are not available', { variant: 'warning' })
}

function openMessageSnippetsDialog() {
    messageSnippetsDialogRef.value?.open()
}

defineExpose({ insertTextAtCursor })
</script>

<template>
    <div class="message-input">
        <div v-if="commentsWithContentCount > 0" class="code-comments-bar">
            <wa-button
                variant="brand"
                appearance="filled-outlined"
                size="small"
                @click="addAllCommentsToMessage"
            >
                {{ commentsWithContentCount === 1
                    ? 'Add comment to message'
                    : `Add all comments (${commentsWithContentCount}) to message`
                }}
            </wa-button>
            <wa-button
                variant="neutral"
                appearance="outlined"
                size="small"
                @click="clearAllSessionComments"
            >
                {{ commentsWithContentCount === 1 ? 'Clear comment' : 'Clear comments' }}
            </wa-button>
        </div>
        <wa-textarea
            ref="textareaRef"
            :id="textareaAnchorId"
            :value.prop="messageText"
            :placeholder="placeholderText"
            rows="3"
            resize="none"
            @input="onInput"
            @keydown="onKeydown"
            @paste="onPaste"
            @focus="adjustTextareaHeight"
        ></wa-textarea>

        <!-- Popups teleported out of the flex container -->
        <Teleport to="body">
            <!-- File picker popup triggered by @ -->
            <FilePickerPopup
                ref="filePickerRef"
                :session-id="sessionId"
                :project-id="projectId"
                :anchor-id="textareaAnchorId"
                @select="onFilePickerSelect"
                @close="onFilePickerClose"
                @filter-change="onFilePickerFilterChange"
            />

            <!-- Slash command picker popup triggered by / at start -->
            <SlashCommandPickerPopup
                ref="slashPickerRef"
                :project-id="projectId"
                :anchor-id="textareaAnchorId"
                @select="onSlashCommandSelect"
                @close="onSlashCommandPickerClose"
                @filter-change="onSlashPickerFilterChange"
            />

            <!-- Message history picker popup triggered by ! at start -->
            <MessageHistoryPickerPopup
                ref="historyPickerRef"
                :project-id="projectId"
                :session-id="sessionId"
                :anchor-id="textareaAnchorId"
                :synthetic-message-text="optimisticMessageText"
                @select="onHistoryMessageSelect"
                @close="onHistoryPickerClose"
                @filter-change="onHistoryPickerFilterChange"
            />
        </Teleport>

        <!-- Message snippets bar -->
        <MessageSnippetsBar
            :snippets="snippetsForProject"
            @snippet-press="handleSnippetPress"
            @snippet-disabled-press="handleSnippetDisabledPress"
            @manage-snippets="openMessageSnippetsDialog"
        />

        <!-- Message snippets dialog (teleported out of the flex container) -->
        <Teleport to="body">
            <MessageSnippetsDialog
                ref="messageSnippetsDialogRef"
                :current-project-id="projectId"
            />
        </Teleport>

        <div class="message-input-toolbar">
            <!-- Attachments row: button on left, thumbnails on right -->
            <div class="message-input-attachments">
                <!-- Hidden file input -->
                <input
                    ref="fileInputRef"
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain"
                    style="display: none;"
                    @change="onFileSelected"
                />

                <!-- Attach button -->
                <wa-button
                    variant="neutral"
                    appearance="plain"
                    size="small"
                    @click="openFilePicker"
                    :id="attachButtonId"
                >
                    <wa-icon name="paperclip"></wa-icon>
                </wa-button>
                <AppTooltip :for="attachButtonId">Attach files (images, PDF, text)</AppTooltip>

                <!-- Attachment badge + popover -->
                <template v-if="attachmentCount > 0">
                    <button
                        :id="`attachments-popover-trigger-${sessionId}`"
                        class="attachments-badge-trigger"
                    >
                        <wa-badge variant="primary" pill>{{ attachmentCount }}</wa-badge>
                    </button>
                    <AppTooltip :for="`attachments-popover-trigger-${sessionId}`">{{ attachmentCount }} file{{ attachmentCount > 1 ? 's' : '' }} attached</AppTooltip>
                    <!-- Temporary tooltip shown when new files are attached -->
                    <wa-tooltip
                        :for="`attachments-popover-trigger-${sessionId}`"
                        trigger="manual"
                        placement="top"
                        :open="showAttachTooltip || undefined"
                    >{{ attachTooltipText }}</wa-tooltip>
                    <wa-popover
                        v-popover-focus-fix
                        :for="`attachments-popover-trigger-${sessionId}`"
                        placement="top"
                        class="attachments-popover"
                    >
                        <MediaThumbnailGroup
                            :items="mediaItems"
                            removable
                            @remove="removeAttachmentByIndex"
                        />
                        <div class="popover-actions">
                            <wa-button
                                variant="danger"
                                appearance="outlined"
                                size="small"
                                @click="removeAllAttachments"
                            >
                                <wa-icon name="trash" slot="prefix"></wa-icon>
                                Remove all
                            </wa-button>
                        </div>
                    </wa-popover>
                </template>
            </div>

            <div class="message-input-actions">
                <!-- Settings summary button + popover -->
                <wa-button
                    :id="settingsButtonId"
                    appearance="plain"
                    variant="neutral"
                    size="small"
                    class="settings-button"
                >
                    <wa-icon name="gear"></wa-icon><span class="settings-summary"><template v-for="(part, i) in settingsSummaryParts" :key="i"><span v-if="i"> · </span><span v-if="part.forced" class="setting-forced">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></span>
                </wa-button>
                <wa-popover
                    v-popover-focus-fix
                    :for="settingsButtonId"
                    placement="top"
                    class="settings-popover"
                >
                    <!-- Actions & callouts (non-scrollable) -->
                    <div v-if="anySettingForced || hasDropdownsChanged || startupSettingsWarning" class="settings-panel-actions">
                        <div v-if="anySettingForced || hasDropdownsChanged" class="settings-panel-links">
                            <a v-if="anySettingForced" class="settings-action-link" @click.prevent="resetAllToDefaults">
                                <wa-icon name="arrow-rotate-left"></wa-icon>
                                Reset all to defaults
                            </a>
                            <a v-if="hasDropdownsChanged" class="settings-action-link" @click.prevent="restoreSettings">
                                <wa-icon name="xmark"></wa-icon>
                                Discard unsaved changes
                            </a>
                        </div>
                        <wa-callout v-if="hasDropdownsChanged" variant="brand" class="settings-info-callout">
                            <wa-icon name="circle-info" slot="icon"></wa-icon>
                            Click "{{ buttonLabel }}" to apply your changes.
                        </wa-callout>
                        <wa-callout v-if="startupSettingsWarning" variant="warning" class="startup-warning-callout">
                            <wa-icon name="triangle-exclamation" slot="icon"></wa-icon>
                            {{ startupSettingsWarning }}
                        </wa-callout>
                    </div>

                    <!-- Settings dropdowns (scrollable) -->
                    <div class="settings-panel">
                        <!-- Model -->
                        <div class="setting-row">
                            <label class="setting-label">Model</label>
                            <wa-select
                                :value.prop="selectedModel === null ? DEFAULT_SENTINEL : selectedModel"
                                @change="selectedModel = $event.target.value === DEFAULT_SENTINEL ? null : $event.target.value"
                                size="small"
                                :disabled="isStarting"
                            >
                                <wa-option :value="DEFAULT_SENTINEL">Default: {{ defaultModelLabel }}</wa-option>
                                <small class="select-group-label">Force to:</small>
                                <wa-option v-for="option in modelOptions" :key="option.value" :value="option.value">
                                    {{ option.label }}
                                </wa-option>
                            </wa-select>
                            <a v-if="selectedModel !== null" class="reset-setting-link" @click.prevent="selectedModel = null">Reset to default: {{ defaultModelLabel }}</a>
                        </div>

                        <!-- Context -->
                        <div class="setting-row">
                            <label class="setting-label">Context</label>
                            <wa-select
                                :value.prop="selectedContextMax === null ? DEFAULT_SENTINEL : String(selectedContextMax)"
                                @change="selectedContextMax = $event.target.value === DEFAULT_SENTINEL ? null : Number($event.target.value)"
                                size="small"
                                :disabled="isStarting || isContextMaxForced"
                            >
                                <wa-option :value="DEFAULT_SENTINEL">Default: {{ defaultContextMaxLabel }}</wa-option>
                                <small class="select-group-label">Force to:</small>
                                <wa-option v-for="option in contextMaxOptions" :key="option.value" :value="option.value">
                                    {{ option.label }}
                                </wa-option>
                            </wa-select>
                            <span v-if="isContextMaxForced" class="setting-help">Forced to 1M: context usage exceeds 85% of 200K.</span>
                            <a v-else-if="selectedContextMax !== null" class="reset-setting-link" @click.prevent="selectedContextMax = null">Reset to default: {{ defaultContextMaxLabel }}</a>
                        </div>

                        <!-- Effort -->
                        <div class="setting-row">
                            <label class="setting-label">Effort</label>
                            <wa-select
                                :value.prop="selectedEffort === null ? DEFAULT_SENTINEL : selectedEffort"
                                @change="selectedEffort = $event.target.value === DEFAULT_SENTINEL ? null : $event.target.value"
                                size="small"
                                :disabled="isStarting"
                            >
                                <wa-option :value="DEFAULT_SENTINEL">Default: {{ defaultEffortLabel }}</wa-option>
                                <small class="select-group-label">Force to:</small>
                                <wa-option v-for="option in effortOptions" :key="option.value" :value="option.value">
                                    {{ option.label }}
                                </wa-option>
                            </wa-select>
                            <a v-if="selectedEffort !== null" class="reset-setting-link" @click.prevent="selectedEffort = null">Reset to default: {{ defaultEffortLabel }}</a>
                        </div>

                        <!-- Thinking -->
                        <div class="setting-row">
                            <label class="setting-label">Thinking</label>
                            <wa-select
                                :value.prop="selectedThinking === null ? DEFAULT_SENTINEL : String(selectedThinking)"
                                @change="selectedThinking = $event.target.value === DEFAULT_SENTINEL ? null : $event.target.value === 'true'"
                                size="small"
                                :disabled="isStarting"
                            >
                                <wa-option :value="DEFAULT_SENTINEL">Default: {{ defaultThinkingLabel }}</wa-option>
                                <small class="select-group-label">Force to:</small>
                                <wa-option v-for="option in thinkingOptions" :key="option.value" :value="option.value">
                                    {{ option.label }}
                                </wa-option>
                            </wa-select>
                            <a v-if="selectedThinking !== null" class="reset-setting-link" @click.prevent="selectedThinking = null">Reset to default: {{ defaultThinkingLabel }}</a>
                        </div>

                        <!-- Permission -->
                        <div class="setting-row">
                            <label class="setting-label">Permission</label>
                            <wa-select
                                :value.prop="selectedPermissionMode === null ? DEFAULT_SENTINEL : selectedPermissionMode"
                                @change="selectedPermissionMode = $event.target.value === DEFAULT_SENTINEL ? null : $event.target.value"
                                size="small"
                                :disabled="isStarting"
                            >
                                <wa-option :value="DEFAULT_SENTINEL">Default: {{ defaultPermissionLabel }}</wa-option>
                                <small class="select-group-label">Force to:</small>
                                <wa-option v-for="option in permissionModeOptions" :key="option.value" :value="option.value" :label="option.label">
                                    <span>{{ option.label }}</span>
                                    <span class="option-description">{{ option.description }}</span>
                                </wa-option>
                            </wa-select>
                            <a v-if="selectedPermissionMode !== null" class="reset-setting-link" @click.prevent="selectedPermissionMode = null">Reset to default: {{ defaultPermissionLabel }}</a>
                        </div>

                        <!-- Claude in Chrome -->
                        <div class="setting-row">
                            <label class="setting-label">Claude built-in Chrome MCP</label>
                            <wa-select
                                :value.prop="selectedClaudeInChrome === null ? DEFAULT_SENTINEL : String(selectedClaudeInChrome)"
                                @change="selectedClaudeInChrome = $event.target.value === DEFAULT_SENTINEL ? null : $event.target.value === 'true'"
                                size="small"
                                :disabled="isStarting"
                            >
                                <wa-option :value="DEFAULT_SENTINEL">Default: {{ defaultChromeLabel }}</wa-option>
                                <small class="select-group-label">Force to:</small>
                                <wa-option v-for="option in claudeInChromeOptions" :key="option.value" :value="option.value">
                                    {{ option.label }}
                                </wa-option>
                            </wa-select>
                            <a v-if="selectedClaudeInChrome !== null" class="reset-setting-link" @click.prevent="selectedClaudeInChrome = null">Reset to default: {{ defaultChromeLabel }}</a>
                        </div>
                    </div>
                </wa-popover>

                <!-- Cancel button for draft sessions -->
                <wa-button
                    v-if="isDraft"
                    variant="neutral"
                    appearance="outlined"
                    @click="handleCancel"
                    size="small"
                    class="cancel-button"
                >
                    <wa-icon name="xmark" variant="classic"></wa-icon>
                    <span>Cancel</span>
                </wa-button>
                <!-- Reset button for existing sessions: resets text and/or dropdowns -->
                <wa-button
                    v-else-if="messageText.trim() || hasDropdownsChanged"
                    variant="neutral"
                    appearance="outlined"
                    @click="handleReset"
                    size="small"
                    class="reset-button"
                >
                    <wa-icon name="xmark" variant="classic"></wa-icon>
                    <span>Reset</span>
                </wa-button>
                <!-- Send / Update button: dynamically labeled based on state -->
                <wa-button
                    variant="brand"
                    :disabled="isDisabled || (!messageText.trim() && !hasSettingsChanged)"
                    @click="handleSend"
                    size="small"
                    class="send-button"
                >
                    <wa-icon :name="buttonIcon" variant="classic"></wa-icon>
                    <span>{{ buttonLabel }}</span>
                </wa-button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.message-input {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    padding: var(--wa-space-s);
    background: var(--main-header-footer-bg-color);
    container: message-input / inline-size;
}

.code-comments-bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--wa-space-xs);
    align-items: center;
}

.message-input wa-textarea::part(textarea) {
    /* Limit height to 40% of visual viewport (accounts for mobile keyboard) */
    max-height: 40dvh;
    /* Allow scrolling when content exceeds max-height */
    overflow-y: auto;
}

.message-input-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--wa-space-s);
    @media (width < 640px) {
        padding-left: 2.75rem;
    }
}

/* When sidebar is closed, the sidebar toggle button overlaps
   the attach button area. Add left padding to make room. */
body.sidebar-closed .message-input-toolbar {
    @media (width >= 640px) {
        padding-left: 3.5rem;
    }
}

.message-input-attachments {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    min-width: 0;
    @media (width < 640px) {
        gap: var(--wa-space-xs);
    }
}

.settings-button {
    wa-icon {
        display: none;
    }
    min-width: 0;
    flex-shrink: 1;
    &::part(label) {
        white-space: wrap;
        font-weight: normal;
        font-size: var(--wa-font-size-s);
    }
}

.settings-popover {
    --max-width: min(30rem, 100vw);
    --arrow-size: 12px;
    &::part(body) {
        max-height: calc(100vh - 8rem);
        display: flex;
        flex-direction: column;
    }
}

.settings-panel {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
    overflow-y: auto;
    flex: 1;
    min-height: 0;
}

.settings-info-callout,
.startup-warning-callout {
    font-size: var(--wa-font-size-xs);
    width: 100%;
}

.settings-panel-actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--wa-space-xs);
    flex-shrink: 0;
    padding-bottom: var(--wa-space-s);
    border-bottom: 1px solid var(--wa-color-border);
}

.settings-panel-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--wa-space-2xs) var(--wa-space-s);
    justify-content: center;
}

.settings-action-link {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-brand-60);
    cursor: pointer;
    text-decoration: none;
    display: flex;
    align-items: center;
    gap: var(--wa-space-3xs);
    &:hover {
        text-decoration: underline;
    }
}

.setting-row {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
}

.setting-label {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
}

.setting-help {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
}

.select-group-label {
    display: block;
    padding: var(--wa-space-3xs) var(--wa-space-l);
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    font-weight: var(--wa-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.reset-setting-link {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-brand-60);
    cursor: pointer;
    text-decoration: none;
    &:hover {
        text-decoration: underline;
    }
}

.setting-forced {
    text-decoration: underline dashed;
    text-underline-offset: 3px;
}

.option-description {
    display: block;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
}

.message-input-actions {
    display: flex;
    gap: var(--wa-space-s);
    flex-shrink: 1;
    min-width: 0;
    align-items: center;
    justify-content: flex-end;
    max-width: calc(100% - 6rem);

    .cancel-button, .reset-button, .send-button {
        flex-shrink: 0;
        wa-icon {
            display: none;
        }
        & > span {
            display: inline-block;
        }
    }
}

/* On narrow widths, show only icons for action buttons */
@container message-input (width < 35rem) {
    .message-input-actions {
        .settings-button {
            &::part(label) {
                line-height: 1.1;
            }
            &::part(base) {
                padding-inline: var(--wa-space-2xs);
            }
        }

        gap: var(--wa-space-2xs);

        .cancel-button, .reset-button, .send-button {
            &::part(base) {
                padding-inline: var(--wa-space-s);
            }

            wa-icon {
                display: inline-flex;
            }

            & > span {
                display: none;
            }
        }
    }
}
@container message-input (width < 24rem) {
    .message-input-actions {
        .settings-button {
            wa-icon {
                display: block;
            }
            & > span {
                display: none;
            }
            &::part(base) {
                padding-inline: var(--wa-space-s);
            }
        }
    }
}

.attachments-badge-trigger {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    box-shadow: none;
    background: var(--wa-color-brand);
    height: 1.5rem;
    min-width: 1.5rem;
    margin-bottom: 0;
}

.attachments-popover {
    --max-width: min(400px, 90vw);
    --arrow-size: 16px;
}

.popover-actions {
    display: flex;
    justify-content: center;
    margin-top: var(--wa-space-l);
}

</style>
