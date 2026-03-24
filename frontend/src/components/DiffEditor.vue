<!-- frontend/src/components/DiffEditor.vue -->
<!-- Wraps @codemirror/merge as a Vue 3 component, supporting both side-by-side (MergeView)
     and unified (EditorView + unifiedMergeView extension) diff modes. -->
<template>
    <div ref="diffEl" class="diff-editor"></div>
</template>

<script setup>
import { ref, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import { EditorView, keymap } from '@codemirror/view'
import { MergeView, unifiedMergeView, goToNextChunk, goToPreviousChunk } from '@codemirror/merge'
import { resolveLanguage, useCodeMirrorExtensions, useSettingsWatcher } from '../composables/useCodeMirror'
import { useSettingsStore } from '../stores/settings'

// ─── Props ───────────────────────────────────────────────────────────────────

const props = defineProps({
    original: { type: String, default: '' },
    modified: { type: String, default: '' },
    filePath: { type: String, default: null },
    language: { type: String, default: null },
    readOnly: { type: Boolean, default: true },
    wordWrap: { type: Boolean, default: false },
    sideBySide: { type: Boolean, default: true },
    collapseUnchanged: { type: Boolean, default: true },
    extensions: { type: Array, default: () => [] },
})

// ─── Emits ───────────────────────────────────────────────────────────────────

const emit = defineEmits(['update:modified', 'save', 'ready'])

// ─── Template ref & state ────────────────────────────────────────────────────

const diffEl = ref(null)

/** True when the document has unsaved local edits (since last external update). */
const isDirty = ref(false)

/** Flag to break the echo loop: set true when we emit an update, cleared next tick. */
let _internalUpdate = false

/** The current view instance: MergeView (side-by-side) or EditorView (unified). */
let currentView = null

/** Current mode: 'side-by-side' | 'unified' */
let currentMode = null

/** Cleanup function returned by useSettingsWatcher. */
let _stopSettingsWatcher = null

// ─── Extension compartments ───────────────────────────────────────────────────
// We manage two sets of compartments: one for the original side (a) and one for
// the modified side (b). For unified mode, only cmB is used (the single EditorView).

const settingsStore = useSettingsStore()
const initialSettings = { initialTheme: settingsStore.getEffectiveTheme, initialFontSize: settingsStore.getFontSize }

// Original side (a) — always read-only
const cmA = useCodeMirrorExtensions({
    readOnly: { value: true },
    wordWrap: { value: props.wordWrap },
}, initialSettings)

// Modified side (b) — read-only based on prop
const cmB = useCodeMirrorExtensions({
    readOnly: { value: props.readOnly },
    wordWrap: { value: props.wordWrap },
}, initialSettings)

// ─── Diff config ─────────────────────────────────────────────────────────────
// Override the default scanLimit (500) to produce more accurate diffs on large,
// heavily-changed files. The timeout acts as a safety net to avoid blocking the
// main thread on pathological inputs.
const diffConfig = { scanLimit: 10000, timeout: 2000 }

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the EditorView for the "modified" side, regardless of mode.
 * For side-by-side: MergeView.b
 * For unified: the single EditorView
 */
function getModifiedView() {
    if (!currentView) return null
    if (currentMode === 'side-by-side') return currentView.b
    return currentView
}

/**
 * Returns the EditorView for the "original" side.
 * Only meaningful in side-by-side mode.
 */
function getOriginalView() {
    if (!currentView || currentMode !== 'side-by-side') return null
    return currentView.a
}

// ─── Update listener & save keymap ───────────────────────────────────────────

function buildUpdateListener() {
    return EditorView.updateListener.of((update) => {
        if (update.docChanged) {
            isDirty.value = true
            _internalUpdate = true
            emit('update:modified', update.state.doc.toString())
            nextTick(() => { _internalUpdate = false })
        }
    })
}

function buildSaveKeymap() {
    return keymap.of([{
        key: 'Mod-s',
        run: () => {
            if (!props.readOnly && isDirty.value) emit('save')
            // Always return true to prevent browser's native Save dialog
            return true
        },
    }])
}

// ─── Settings watcher setup ───────────────────────────────────────────────────

function setupSettingsWatcher() {
    // Stop any existing watcher before setting up a new one
    if (_stopSettingsWatcher) {
        _stopSettingsWatcher()
        _stopSettingsWatcher = null
    }

    if (currentMode === 'side-by-side') {
        // In side-by-side mode, we need to reconfigure both EditorViews.
        // We register one watcher that updates both.
        _stopSettingsWatcher = useSettingsWatcher(
            () => getModifiedView(),
            cmB,
        )
        // Also watch for changes to update the original side (cmA)
        // We do this by wrapping: patch the stop function to also handle cmA
        const stopA = useSettingsWatcher(
            () => getOriginalView(),
            cmA,
        )
        const stopB = _stopSettingsWatcher
        _stopSettingsWatcher = () => { stopA(); stopB() }
    } else {
        // Unified mode: single EditorView managed by cmB
        _stopSettingsWatcher = useSettingsWatcher(
            () => getModifiedView(),
            cmB,
        )
    }
}

// ─── Create side-by-side (MergeView) ─────────────────────────────────────────

async function createSideBySideView() {
    const langExtension = await resolveLanguage(props.filePath, props.language)

    const updateListener = buildUpdateListener()
    const saveKeymap = buildSaveKeymap()

    // Original side (a): always read-only, no save keymap, no update listener
    const aExtensions = [
        ...cmA.extensions,
        ...(langExtension ? [langExtension] : []),
        ...props.extensions,
    ]

    // Modified side (b): read-only based on prop, plus save keymap and update listener
    const bExtensions = [
        ...cmB.extensions,
        ...(langExtension ? [langExtension] : []),
        saveKeymap,
        updateListener,
        ...props.extensions,
    ]

    currentView = new MergeView({
        a: { doc: props.original, extensions: aExtensions },
        b: { doc: props.modified, extensions: bExtensions },
        parent: diffEl.value,
        root: document, // Force styles into document head, not WA shadow root
        collapseUnchanged: props.collapseUnchanged ? {} : undefined,
        mergeControls: false,
        diffConfig,
    })

    currentMode = 'side-by-side'

    setupSettingsWatcher()
}

// ─── Create unified (EditorView + unifiedMergeView) ──────────────────────────

async function createUnifiedView() {
    const langExtension = await resolveLanguage(props.filePath, props.language)

    const updateListener = buildUpdateListener()
    const saveKeymap = buildSaveKeymap()

    const unifiedExt = unifiedMergeView({
        original: props.original,
        highlightChanges: true,
        gutter: true,
        mergeControls: false,
        collapseUnchanged: props.collapseUnchanged
            ? { margin: 3, minSize: 4 }
            : undefined,
        diffConfig,
    })

    const allExtensions = [
        ...cmB.extensions,
        ...(langExtension ? [langExtension] : []),
        unifiedExt,
        saveKeymap,
        updateListener,
        ...props.extensions,
    ]

    currentView = new EditorView({
        doc: props.modified,
        extensions: allExtensions,
        parent: diffEl.value,
        root: document, // Force styles into document head, not WA shadow root
    })

    currentMode = 'unified'

    setupSettingsWatcher()
}

// ─── Destroy ─────────────────────────────────────────────────────────────────

function destroyCurrentView() {
    if (_stopSettingsWatcher) {
        _stopSettingsWatcher()
        _stopSettingsWatcher = null
    }
    if (currentView) {
        currentView.destroy()
        currentView = null
    }
    currentMode = null
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

onMounted(async () => {
    if (props.sideBySide) {
        await createSideBySideView()
    } else {
        await createUnifiedView()
    }
    emit('ready')
})

onBeforeUnmount(() => {
    destroyCurrentView()
})

// ─── Watchers ────────────────────────────────────────────────────────────────

// Mode switch: destroy + recreate in the other mode
watch(() => props.sideBySide, async (newSideBySide) => {
    destroyCurrentView()
    isDirty.value = false
    if (newSideBySide) {
        await createSideBySideView()
    } else {
        await createUnifiedView()
    }
})

// Content changed (file/commit switch): original or modified prop changed.
// Destroy and recreate in both modes — in-place updates in unified mode are fragile
// (two separate dispatches for original + modified can desync the diff engine).
watch([() => props.original, () => props.modified], async () => {
    if (_internalUpdate) return

    const wasMode = currentMode
    destroyCurrentView()
    if (wasMode === 'side-by-side') {
        await createSideBySideView()
    } else {
        await createUnifiedView()
    }
    isDirty.value = false
})

// readOnly toggle — only affects the modified side (b)
watch(() => props.readOnly, (newReadOnly) => {
    const view = getModifiedView()
    if (!view) return
    cmB.reconfigure(view, 'readOnly', newReadOnly)
})

// wordWrap toggle — affects both sides
watch(() => props.wordWrap, (newWordWrap) => {
    const modView = getModifiedView()
    if (modView) cmB.reconfigure(modView, 'wordWrap', newWordWrap)

    const origView = getOriginalView()
    if (origView) cmA.reconfigure(origView, 'wordWrap', newWordWrap)
})

// File path change — re-resolve language and reconfigure both sides
watch(() => props.filePath, async () => {
    const langExtension = await resolveLanguage(props.filePath, props.language)
    const modView = getModifiedView()
    if (modView) cmB.reconfigure(modView, 'language', langExtension)
    const origView = getOriginalView()
    if (origView) cmA.reconfigure(origView, 'language', langExtension)
})

// Explicit language override change
watch(() => props.language, async () => {
    const langExtension = await resolveLanguage(props.filePath, props.language)
    const modView = getModifiedView()
    if (modView) cmB.reconfigure(modView, 'language', langExtension)
    const origView = getOriginalView()
    if (origView) cmA.reconfigure(origView, 'language', langExtension)
})

// ─── Diff navigation ─────────────────────────────────────────────────────────

function goToNext() {
    const v = getModifiedView()
    if (v) {
        v.focus()
        goToNextChunk(v)
    }
}

function goToPrev() {
    const v = getModifiedView()
    if (v) {
        v.focus()
        goToPreviousChunk(v)
    }
}

// ─── Exposed API ─────────────────────────────────────────────────────────────

defineExpose({
    goToNextChunk: goToNext,
    goToPreviousChunk: goToPrev,
    isDirty,
    resetDirty() { isDirty.value = false },
})
</script>

<style scoped>
.diff-editor {
    width: 100%;
    height: 100%;
}

.diff-editor :deep(.cm-editor),
.diff-editor :deep(.cm-mergeView) {
    height: 100%;
}
</style>

<style>
/* ── Diff highlighting ────────────────────────────────────────────────── */
/* Colors are defined as CSS variables in App.vue (:root / .wa-dark)     */
    
.diff-editor .cm-content {

	.cm-changedLine {
		--diff-changeLineBackground: transparent;
	    background: var(--diff-changeLineBackground);
        --diff-changeLineBackground: var(--diff-insertedLineBackground);
		&:has(.cm-deletedLine) {
			--diff-changeLineBackground: var(--diff-removedLineBackground);
		}
	}
	.cm-deletedChunk {
	    background: var(--diff-removedLineBackground);
	}

	.cm-insertedLine, .cm-deletedLine {
	    background: transparent;
        &::selection, ::selection {
             background: var(--diff-selectionBackground) !important;
        }
	}

	.cm-line {
        .cm-changedText, .cm-deletedText {
	        border-bottom: none;
	        display: inline-block;
            --diff-textBackground: transparent;
	        background: var(--diff-textBackground);
            &::selection, ::selection {
                 background: var(--diff-selectionBackground) !important;
            }
        }
	}

	.cm-insertedLine .cm-changedText {
        --diff-textBackground: var(--diff-insertedTextBackground);
	}
	.cm-deletedLine {
		.cm-changedText, .cm-deletedText {
	    	--diff-textBackground: var(--diff-removedTextBackground);
	    }
	}

    .cm-mergeSpacer {
        --stripe-width: 5px;
        background: repeating-linear-gradient(
            -45deg,
            transparent,
            transparent 4px,
            var(--wa-color-surface-lowered) 4px,
            var(--wa-color-surface-lowered) calc(4px + var(--stripe-width))
        );
    }

}

.diff-editor .cm-merge-a .cm-changedLine {
    --diff-changeLineBackground: var(--diff-removedLineBackground);
}

/* Force background in dark mode */
html.wa-dark {
  .cm-editor, .cm-gutters {
      background: var(--wa-color-surface-default) !important;
  }
}

/* Better active line gutter in dark mode */
html.wa-dark {
    .cm-editor .cm-activeLineGutter {
      background: var(--wa-color-surface-lowered) !important;
    }
}

  
/* Collapsed unchanged lines separator (dark mode only, unscoped for .wa-dark ancestor) */
html.wa-dark .diff-editor .cm-collapsedLines {
    background: var(--wa-color-surface-lowered);
    color: var(--wa-color-text-quiet)
}
</style>
