<script setup>
import { computed } from 'vue'
import { getLanguageFromPath } from '../../../utils/languages'
import MarkdownContent from '../../MarkdownContent.vue'

const props = defineProps({
    input: {
        type: Object,
        required: true
    }
})

/**
 * Render the file content as a syntax-highlighted fenced code block.
 * Language is detected from file_path.
 */
const codeSource = computed(() => {
    const content = props.input.content ?? ''
    const language = getLanguageFromPath(props.input.file_path) || ''
    return '```' + language + '\n' + content + '\n```'
})
</script>

<template>
    <div class="write-content">
        <MarkdownContent :source="codeSource" />
    </div>
</template>

<style scoped>
.write-content {
    padding: var(--wa-space-xs) 0;
}

.write-content :deep(.markdown-body) {
    max-height: 20.25rem;
    overflow: auto;
}
</style>
