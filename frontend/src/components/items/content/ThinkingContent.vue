<script setup>
import { ref, nextTick, onMounted } from 'vue'
import { useDataStore } from '../../../stores/data'
import MarkdownContent from '../../MarkdownContent.vue'

const dataStore = useDataStore()

const props = defineProps({
    thinking: {
        type: String,
        required: true
    },
    sessionId: {
        type: String,
        required: true
    },
    detailKey: {
        type: String,
        required: true
    }
})

const detailsRef = ref(null)

// Lazy rendering: content is only mounted when wa-details is open.
// Initialized from the store to restore state across virtual scroller mount/unmount cycles.
const isOpen = ref(dataStore.isDetailOpen(props.sessionId, props.detailKey))

// Restore wa-details open state on mount (when re-entering virtual scroller viewport)
onMounted(() => {
    if (isOpen.value) {
        nextTick(() => detailsRef.value?.show())
    }
})

function onShow() {
    isOpen.value = true
    dataStore.setDetailOpen(props.sessionId, props.detailKey, true)
}

function onHide() {
    isOpen.value = false
    dataStore.setDetailOpen(props.sessionId, props.detailKey, false)
}
</script>

<template>
    <wa-details ref="detailsRef" class="item-details thinking-content" icon-placement="start" @wa-show="onShow" @wa-hide="onHide">
        <span slot="summary" class="items-details-summary">
            <strong class="items-details-summary-name">Thinking</strong>
        </span>
        <div v-if="isOpen" class="thinking-body">
            <MarkdownContent :source="thinking" />
        </div>
    </wa-details>
</template>

<style scoped>
wa-details::part(content) {
    padding-top: 0;
}

.thinking-body {
    padding: var(--wa-space-xs) 0;
    word-break: break-word;
}
</style>
