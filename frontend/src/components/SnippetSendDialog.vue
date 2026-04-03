<script setup>
// SnippetSendDialog.vue - One-shot dialog to edit a snippet's text before sending it to a terminal.
// Nothing is persisted — the edited text is used for this single send only.
import { ref, computed, nextTick } from 'vue'
import SnippetTextEditor from './SnippetTextEditor.vue'
import { extractPlaceholders, getUnavailablePlaceholders } from '../utils/snippetPlaceholders'

const props = defineProps({
    terminals: {
        type: Array,
        default: () => [],
    },
    activeTerminalIndex: {
        type: Number,
        default: 0,
    },
    placeholderContext: {
        type: Object,
        default: () => ({}),
    },
})

const emit = defineEmits(['send'])

// ── Dialog refs ─────────────────────────────────────────────────────
const dialogRef = ref(null)
const textEditorRef = ref(null)

// ── Form state ──────────────────────────────────────────────────────
const formData = ref(null)  // { text, appendEnter, openInNewTab, originalSnippet }

// ── Placeholder validation (reactive, updates as user edits text) ───
const unavailable = computed(() => {
    if (!formData.value) return []
    const ids = extractPlaceholders(formData.value.text)
    if (ids.length === 0) return []
    return getUnavailablePlaceholders(ids, props.placeholderContext)
})

const sendDisabled = computed(() => unavailable.value.length > 0)

// ── Dialog lifecycle ────────────────────────────────────────────────

// Guard dialog events against bubbling from child wa-select/wa-dropdown
function handleDialogAfterShow(e) {
    if (e.target !== dialogRef.value) return
    nextTick(() => textEditorRef.value?.focus())
}

function handleDialogHide(e) {
    if (e.target !== dialogRef.value) return
    // Let the dialog close normally
}

function open(snippet) {
    formData.value = {
        text: snippet.snippet,
        appendEnter: snippet.appendEnter,
        openInNewTab: snippet.openInNewTab || false,
        originalSnippet: snippet,
    }
    if (dialogRef.value) {
        dialogRef.value.open = true
    }
}

function close() {
    if (dialogRef.value) {
        dialogRef.value.open = false
    }
}

// ── Send helpers ────────────────────────────────────────────────────

/** Build a transient snippet object from the current form state.
 *  Re-extracts placeholders since the user may have edited the text. */
function buildSnippet() {
    const text = formData.value.text
    return {
        ...formData.value.originalSnippet,
        snippet: text,
        appendEnter: formData.value.appendEnter,
        openInNewTab: formData.value.openInNewTab,
        placeholders: extractPlaceholders(text),
    }
}

/** Main "Send" button: respect openInNewTab checkbox. */
function handleSend() {
    if (sendDisabled.value) return
    const snippet = buildSnippet()
    const target = snippet.openInNewTab ? 'new' : String(props.activeTerminalIndex)
    emit('send', snippet, target)
    close()
}

/** Dropdown: send to a specific terminal or new tab. */
function handleSendTo(event) {
    if (sendDisabled.value) return
    const value = event.detail?.item?.value
    if (!value) return
    emit('send', buildSnippet(), value)
    close()
}

defineExpose({ open, close })
</script>

<template>
    <wa-dialog
        ref="dialogRef"
        label="Edit & Send Snippet"
        class="snippet-send-dialog"
        @wa-after-show="handleDialogAfterShow"
        @wa-hide="handleDialogHide"
    >
        <div v-if="formData" class="dialog-content">
            <SnippetTextEditor
                ref="textEditorRef"
                v-model:text="formData.text"
                v-model:append-enter="formData.appendEnter"
                v-model:open-in-new-tab="formData.openInNewTab"
            />

            <!-- Unavailable placeholders warning -->
            <wa-callout v-if="sendDisabled" variant="danger" size="small">
                Cannot send: unavailable placeholders — {{ unavailable.map(p => p.label).join(', ') }}
            </wa-callout>
        </div>

        <!-- ═══ FOOTER ═══ -->
        <div slot="footer" class="dialog-footer">
            <wa-button variant="neutral" appearance="outlined" @click="close">
                Cancel
            </wa-button>

            <!-- Split button: Send + dropdown for target selection -->
            <div class="send-split-group">
                <wa-button variant="brand" class="send-main-btn" :disabled="sendDisabled" @click="handleSend">
                    Send
                </wa-button>
                <wa-dropdown placement="top-end" :disabled="sendDisabled" @wa-select="handleSendTo">
                    <wa-button slot="trigger" variant="brand" class="send-arrow-btn" :disabled="sendDisabled">
                        <wa-icon name="chevron-up"></wa-icon>
                    </wa-button>
                    <wa-dropdown-item disabled class="dropdown-label">Send to tab</wa-dropdown-item>
                    <wa-dropdown-item
                        v-for="term in terminals"
                        :key="term.index"
                        :value="String(term.index)"
                    >
                        {{ term.label }}<template v-if="term.index === activeTerminalIndex"> (current)</template>
                    </wa-dropdown-item>
                    <wa-divider></wa-divider>
                    <wa-dropdown-item value="new">
                        <wa-icon slot="prefix" name="plus"></wa-icon>
                        New tab
                    </wa-dropdown-item>
                </wa-dropdown>
            </div>
        </div>
    </wa-dialog>
</template>

<style scoped>
.snippet-send-dialog {
    --width: min(40rem, calc(100vw - 2rem));
}

.dialog-content {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
}

/* ── Footer ──────────────────────────────────────────────────────── */
.dialog-footer {
    display: flex;
    gap: var(--wa-space-s);
    justify-content: flex-end;
}

/* ── Split button group ──────────────────────────────────────────── */
.send-split-group {
    display: inline-flex;
    align-items: stretch;
}

.send-main-btn::part(base) {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
}

.send-arrow-btn {
    /* Collapse left border to avoid double-border between buttons */
    margin-left: -1px;
}

.send-arrow-btn::part(base) {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    /* Narrower padding for the chevron-only button */
    padding-inline: 0.5em;
    min-width: unset;
}

</style>
