<script setup>
// MessageSnippetsBar.vue - Displays message snippets as compact buttons below the textarea
// Visual style mirrors the snippets tab in TerminalExtraKeysBar.vue
import { useMessageSnippetsStore } from '../stores/messageSnippets'
import { useDataStore } from '../stores/data'
import { useWorkspacesStore } from '../stores/workspaces'
import AppTooltip from './AppTooltip.vue'

defineProps({
    /** Pre-enriched snippets (with _disabled / _disabledReason from parent). */
    snippets: {
        type: Array,
        default: () => [],
    },
    /** Whether to show the message history button (hidden in draft mode). */
    showHistoryButton: {
        type: Boolean,
        default: false,
    },
})

const emit = defineEmits(['snippet-press', 'snippet-disabled-press', 'manage-snippets', 'open-history'])

const messageSnippetsStore = useMessageSnippetsStore()
const dataStore = useDataStore()
const workspacesStore = useWorkspacesStore()

function snippetScopeInfo(snippet) {
    const scope = snippet._scope
    if (!scope) return null
    if (scope.startsWith('project:')) {
        const project = dataStore.getProject(scope.slice(8))
        return { type: 'project', color: project?.color || null }
    }
    if (scope.startsWith('workspace:')) {
        const ws = workspacesStore.getWorkspaceById(scope.slice(10))
        return { type: 'workspace', color: ws?.color || null }
    }
    return null
}

/** Display text for a snippet: label if set, otherwise truncated text (10 chars + ellipsis). */
function snippetDisplayText(snippet) {
    if (snippet.label) return snippet.label
    const text = snippet.text || ''
    if (text.length <= 10) return text
    return text.slice(0, 10) + '…'
}

function handleSnippetClick(snippet) {
    if (snippet._disabled) {
        emit('snippet-disabled-press', snippet)
    } else {
        emit('snippet-press', snippet)
    }
}
</script>

<template>
    <div v-if="snippets.length > 0 || messageSnippetsStore._initialized" class="message-snippets-bar">
        <button
            v-if="showHistoryButton"
            class="snippet-btn history-btn"
            title="Browse previous messages"
            @click="emit('open-history')"
        >
            <wa-icon name="arrow-up"></wa-icon>
        </button>
        <wa-divider v-if="showHistoryButton" orientation="vertical" class="history-divider"></wa-divider>
        <template v-if="snippets.length > 0">
            <template v-for="(snippet, i) in snippets" :key="i">
                <button
                    :id="snippet._disabled ? `disabled-msg-snippet-${i}` : undefined"
                    class="snippet-btn"
                    :class="{ 'snippet-disabled': snippet._disabled }"
                    :title="snippet.text"
                    @click="handleSnippetClick(snippet)"
                >
                    <template v-if="snippetScopeInfo(snippet)?.type === 'project'">
                        <span
                            class="snippet-scope-dot"
                            :style="snippetScopeInfo(snippet).color ? { '--dot-color': snippetScopeInfo(snippet).color } : null"
                        ></span>
                    </template>
                    <template v-else-if="snippetScopeInfo(snippet)?.type === 'workspace'">
                        <wa-icon
                            name="layer-group"
                            class="snippet-scope-icon"
                            :style="snippetScopeInfo(snippet).color ? { color: snippetScopeInfo(snippet).color } : null"
                        ></wa-icon>
                    </template>
                    {{ snippetDisplayText(snippet) }}
                </button>
                <AppTooltip v-if="snippet._disabled" :for="`disabled-msg-snippet-${i}`">
                    {{ snippet._disabledReason }}
                </AppTooltip>
            </template>
        </template>
        <span v-else class="empty-text">No snippets</span>
        <button
            class="snippet-btn manage-btn"
            @click="emit('manage-snippets')"
        >⚙ Manage</button>
    </div>
</template>

<style scoped>
/* ── Reset ── */
button {
    box-shadow: none !important;
    margin: 0;
}

/* ── Bar container ─────────────────────────────────────────────────── */
.message-snippets-bar {
    display: flex;
    gap: var(--wa-space-2xs);
    flex-wrap: wrap;
    align-items: center;
}

/* On mobile: single-line horizontal scroll */
@media (width < 640px) {
    .message-snippets-bar {
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none; /* Firefox */
        -webkit-overflow-scrolling: touch;
    }
    .message-snippets-bar::-webkit-scrollbar {
        display: none; /* Chrome/Safari */
    }
}

/* Scroll shadow indicators — progressive enhancement (same pattern as SettingsPopover) */
@supports (container-type: scroll-state) {
    @media (width < 640px) {
        .message-snippets-bar {
            container-type: scroll-state;
        }

        .message-snippets-bar::before,
        .message-snippets-bar::after {
            --_shadow-color: color-mix(in srgb, var(--wa-color-text-normal) 12%, transparent);
            --_fade-size: var(--wa-space-s);
            content: '';
            display: block;
            flex-shrink: 0;
            position: sticky;
            width: var(--_fade-size);
            align-self: stretch;
            z-index: 2;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease;
        }

        .message-snippets-bar::before {
            order: -1;
            left: 0;
            margin-right: calc(-1 * var(--_fade-size));
            background: linear-gradient(to right, var(--_shadow-color), transparent);
        }

        .message-snippets-bar::after {
            order: 9999;
            right: 0;
            margin-left: calc(-1 * var(--_fade-size));
            background: linear-gradient(to left, var(--_shadow-color), transparent);
        }

        @container scroll-state(scrollable: left) {
            .message-snippets-bar::before {
                opacity: 1;
            }
        }

        @container scroll-state(scrollable: right) {
            .message-snippets-bar::after {
                opacity: 1;
            }
        }
    }
}

/* ── Snippet buttons (same visual style as TerminalExtraKeysBar) ──── */
.snippet-btn {
    background: var(--wa-color-surface-raised);
    border: 1px solid var(--wa-color-surface-border);
    color: var(--wa-color-text-normal);
    font-family: var(--wa-font-family-code);
    font-size: var(--wa-font-size-xs);
    height: 1.75rem;
    border-radius: var(--wa-border-radius-s);
    cursor: pointer;
    transition: background-color 0.1s, border-color 0.1s, transform 0.1s;
    touch-action: manipulation;
    -webkit-user-select: none;
    user-select: none;
    line-height: 1;
    padding: 0 var(--wa-space-xs);
    display: inline-flex;
    align-items: center;
    gap: var(--wa-space-xs);
}

.snippet-btn:hover {
    background: color-mix(in srgb, var(--wa-color-surface-raised), var(--wa-color-mix-hover));
}

.snippet-btn:active {
    background: color-mix(in srgb, var(--wa-color-surface-raised), var(--wa-color-mix-active));
    transform: scale(0.95);
}

/* ── Disabled snippets ────────────────────────────────────────────── */
.snippet-btn.snippet-disabled {
    opacity: 0.35;
    cursor: not-allowed;
}

.snippet-btn.snippet-disabled:hover {
    background: var(--wa-color-surface-raised);
    transform: none;
}

.snippet-btn.snippet-disabled:active {
    transform: none;
}

/* ── Scope indicators ────────────────────────────────────────────── */
.snippet-scope-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex-shrink: 0;
    border: 1px solid;
    box-sizing: border-box;
    background-color: var(--dot-color, transparent);
    border-color: var(--dot-color, var(--wa-color-border-quiet));
}

.snippet-scope-icon {
    font-size: 0.7em;
    flex-shrink: 0;
}

/* ── Empty text ──────────────────────────────────────────────────── */
.empty-text {
    font-size: var(--wa-font-size-xs);
    opacity: 0.4;
    padding: var(--wa-space-2xs) var(--wa-space-xs);
    align-self: center;
}

/* ── History button ───────────────────────────────────────────────── */
.snippet-btn.history-btn {
    padding: 0 var(--wa-space-2xs);
}

.history-divider {
    align-self: stretch;
    --spacing: var(--wa-space-2xs);
    height: auto;
}

/* ── Manage button ────────────────────────────────────────────────── */
.snippet-btn.manage-btn {
    border-style: dashed;
    opacity: 0.6;
    font-size: var(--wa-font-size-xs);
}

.snippet-btn.manage-btn:hover {
    opacity: 0.9;
}
</style>
