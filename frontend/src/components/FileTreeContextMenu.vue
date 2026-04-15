<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
    visible: { type: Boolean, default: false },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    nodeName: { type: String, default: '' },
    nodeType: { type: String, default: 'file' },
    relativePath: { type: String, default: '' },
    fullPath: { type: String, default: '' },
    writable: { type: Boolean, default: false },
    writableLoading: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'create-file', 'create-folder', 'rename', 'move', 'delete', 'copy-name', 'copy-relative-path', 'copy-full-path'])

const dropdownRef = ref(null)
const triggerRef = ref(null)
let openedByUs = false

function handleSelect(event) {
    const value = event.detail?.item?.value
    if (!value) return
    emit(value)
    emit('close')
}

function handleHide() {
    if (openedByUs) {
        openedByUs = false
        emit('close')
    }
}

watch(() => props.visible, async (visible) => {
    if (visible) {
        await nextTick()
        if (triggerRef.value) {
            triggerRef.value.style.left = `${props.x}px`
            triggerRef.value.style.top = `${props.y}px`
        }
        await nextTick()
        if (dropdownRef.value) {
            openedByUs = true
            dropdownRef.value.open = true
        }
    } else {
        openedByUs = false
        if (dropdownRef.value) {
            dropdownRef.value.open = false
        }
    }
})

watch([() => props.x, () => props.y], () => {
    if (triggerRef.value && props.visible) {
        triggerRef.value.style.left = `${props.x}px`
        triggerRef.value.style.top = `${props.y}px`
    }
})
</script>

<template>
    <Teleport to="body">
        <wa-dropdown
            ref="dropdownRef"
            placement="bottom-start"
            :distance="0"
            class="context-menu-dropdown"
            @wa-select="handleSelect"
            @wa-after-hide="handleHide"
        >
            <span
                ref="triggerRef"
                slot="trigger"
                class="context-menu-trigger"
            ></span>

            <wa-dropdown-item disabled class="context-menu-header">
                {{ nodeName }}
            </wa-dropdown-item>
            <wa-divider></wa-divider>

            <wa-dropdown-item
                v-if="nodeType === 'directory'"
                value="create-file"
                :disabled="writableLoading || !writable"
            >
                <wa-icon slot="icon" name="file-circle-plus"></wa-icon>
                New file
            </wa-dropdown-item>
            <wa-dropdown-item
                v-if="nodeType === 'directory'"
                value="create-folder"
                :disabled="writableLoading || !writable"
            >
                <wa-icon slot="icon" name="folder-plus"></wa-icon>
                New folder
            </wa-dropdown-item>
            <wa-divider v-if="nodeType === 'directory'"></wa-divider>

            <wa-dropdown-item
                value="rename"
                :disabled="writableLoading || !writable"
            >
                <wa-icon slot="icon" name="pencil"></wa-icon>
                Rename
            </wa-dropdown-item>
            <wa-dropdown-item
                value="move"
                :disabled="writableLoading || !writable"
            >
                <wa-icon slot="icon" name="arrow-right-arrow-left"></wa-icon>
                Move
            </wa-dropdown-item>
            <wa-dropdown-item
                value="delete"
                class="danger-item"
                :disabled="writableLoading || !writable"
            >
                <wa-icon slot="icon" name="trash"></wa-icon>
                Delete
            </wa-dropdown-item>

            <wa-divider></wa-divider>

            <wa-dropdown-item value="copy-name">
                <wa-icon slot="icon" name="copy"></wa-icon>
                <div>Copy name</div>
                <div class="copy-preview">{{ nodeName }}</div>
            </wa-dropdown-item>
            <wa-dropdown-item value="copy-relative-path">
                <wa-icon slot="icon" name="copy"></wa-icon>
                <div>Copy relative path</div>
                <div class="copy-preview">{{ relativePath }}</div>
            </wa-dropdown-item>
            <wa-dropdown-item value="copy-full-path">
                <wa-icon slot="icon" name="copy"></wa-icon>
                <div>Copy full path</div>
                <div class="copy-preview">{{ fullPath }}</div>
            </wa-dropdown-item>
        </wa-dropdown>
    </Teleport>
</template>

<style scoped>
.context-menu-trigger {
    position: fixed;
    width: 0;
    height: 0;
    overflow: hidden;
    pointer-events: none;
}

.danger-item::part(base) {
    color: var(--wa-color-danger-fill-loud);
}

.context-menu-header {
    font-size: var(--wa-font-size-s);
}

.copy-preview {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
}
</style>
