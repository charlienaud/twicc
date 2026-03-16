<script setup>
import { computed } from 'vue'
import { structuredPatch } from 'diff'
import { getLanguageFromPath } from '../../../utils/languages'
import MarkdownContent from '../../MarkdownContent.vue'

const props = defineProps({
    input: {
        type: Object,
        required: true
    }
})

/**
 * Generate a unified diff between old_string and new_string, rendered as a ```diff fenced block.
 * Uses the same approach as JsonHumanView's generateDiff.
 */
const diffSource = computed(() => {
    const oldStr = props.input.old_string ?? ''
    const newStr = props.input.new_string ?? ''
    const result = structuredPatch('', '', oldStr, newStr, '', '', { context: 3 })
    const lines = []
    for (const hunk of result.hunks) {
        for (const line of hunk.lines) {
            // Skip "No newline at end of file" markers
            if (line.startsWith('\\')) continue
            lines.push(line)
        }
    }
    return '```diff\n' + lines.join('\n') + '\n```'
})

const isReplaceAll = computed(() => !!props.input.replace_all)
</script>

<template>
    <div class="edit-content">
        <div v-if="isReplaceAll" class="edit-replace-all">Replace all occurrences</div>
        <MarkdownContent :source="diffSource" />
    </div>
</template>

<style scoped>
.edit-content {
    padding: var(--wa-space-xs) 0;
}

.edit-replace-all {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    font-style: italic;
    margin-bottom: var(--wa-space-xs);
}

/* Hide the "DIFF" language label — always diff here, no need to show it */
.edit-content :deep(.markdown-body) {
    max-height: 20.25rem;
    overflow: auto;
}

/* Hide the "DIFF" language label — always diff here, no need to show it */
.edit-content :deep(pre.shiki[data-language="diff"]) {
    padding-top: 16px;
}
.edit-content :deep(pre.shiki[data-language="diff"]::before) {
    display: none;
}
</style>
