<script setup>
/**
 * ProjectTreeNode - Recursive component that renders a single node of the project tree.
 *
 * Two rendering modes:
 * - Folder node (no project): chevron icon + segment label, click toggles open/closed.
 * - Project node (has project): wa-card with full project info. If it also has children,
 *   a chevron in the title row toggles children visibility.
 *
 * Self-recursive: renders <ProjectTreeNode> for each child. Indentation is handled
 * via DOM nesting with padding-left on .tree-children.
 */
import { ref, computed } from 'vue'
import { useDataStore } from '../stores/data'
import { useSettingsStore } from '../stores/settings'
import { formatDate } from '../utils/date'
import { SESSION_TIME_FORMAT } from '../constants'
import ProjectBadge from './ProjectBadge.vue'
import ProjectProcessIndicator from './ProjectProcessIndicator.vue'
import ActivitySparkline from './ActivitySparkline.vue'
import CostDisplay from './CostDisplay.vue'
import AppTooltip from './AppTooltip.vue'

const props = defineProps({
    node: {
        type: Object,
        required: true,
    },
})

const emit = defineEmits(['select', 'edit'])

const store = useDataStore()
const settingsStore = useSettingsStore()

// All nodes start open by default
const isOpen = ref(true)

// Settings for display
const showCosts = computed(() => settingsStore.areCostsShown)
const sessionTimeFormat = computed(() => settingsStore.getSessionTimeFormat)
const useRelativeTime = computed(() =>
    sessionTimeFormat.value === SESSION_TIME_FORMAT.RELATIVE_SHORT ||
    sessionTimeFormat.value === SESSION_TIME_FORMAT.RELATIVE_NARROW
)
const relativeTimeFormat = computed(() =>
    sessionTimeFormat.value === SESSION_TIME_FORMAT.RELATIVE_SHORT ? 'short' : 'narrow'
)

const hasChildren = computed(() => props.node.children && props.node.children.length > 0)
const isFolder = computed(() => props.node.project === null)
const project = computed(() => props.node.project)

/**
 * Convert Unix timestamp (seconds) to Date object for wa-relative-time.
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {Date}
 */
function timestampToDate(timestamp) {
    return new Date(timestamp * 1000)
}

function toggleOpen() {
    isOpen.value = !isOpen.value
}

function handleSelect(proj) {
    emit('select', proj)
}

function handleEditClick(event, proj) {
    event.stopPropagation()
    emit('edit', proj)
}

// Re-emit child events
function onChildSelect(proj) {
    emit('select', proj)
}

function onChildEdit(proj) {
    emit('edit', proj)
}
</script>

<template>
    <div class="tree-node">
        <!-- Folder node (no project) -->
        <div v-if="isFolder" class="folder-header" @click="toggleOpen">
            <wa-icon
                :name="isOpen ? 'chevron-down' : 'chevron-right'"
                class="chevron-icon"
            ></wa-icon>
            <span class="folder-label">{{ node.segment }}</span>
        </div>

        <!-- Project node (has project) -->
        <wa-card
            v-else
            class="project-card"
            appearance="outlined"
            @click="handleSelect(project)"
        >
            <div class="project-info">
                <div class="project-title-row">
                    <wa-icon
                        v-if="hasChildren"
                        :name="isOpen ? 'chevron-down' : 'chevron-right'"
                        class="chevron-icon tree-chevron"
                        @click.stop="toggleOpen"
                    ></wa-icon>
                    <ProjectBadge :project-id="project.id" class="project-title" />
                    <ProjectProcessIndicator :project-id="project.id" size="small" />
                </div>
                <wa-button
                    :id="`edit-button-${project.id}`"
                    variant="neutral"
                    appearance="plain"
                    size="small"
                    class="edit-button"
                    @click="(e) => handleEditClick(e, project)"
                >
                    <wa-icon name="pencil"></wa-icon>
                </wa-button>
                <AppTooltip :for="`edit-button-${project.id}`">Edit project (name and color)</AppTooltip>
                <div v-if="project.directory" class="project-directory">{{ project.directory }}</div>
                <div class="project-meta-wrapper">
                    <div class="project-meta">
                        <span :id="`sessions-count-${project.id}`" class="sessions-count">
                            <wa-icon auto-width name="folder-open" variant="regular"></wa-icon>
                            <span>{{ project.sessions_count }} session{{ project.sessions_count !== 1 ? 's' : '' }}</span>
                        </span>
                        <AppTooltip :for="`sessions-count-${project.id}`">Number of sessions</AppTooltip>
                        <template v-if="showCosts">
                            <CostDisplay :id="`project-cost-${project.id}`" :cost="project.total_cost" class="project-cost" />
                            <AppTooltip :for="`project-cost-${project.id}`">Total project cost</AppTooltip>
                        </template>
                        <span :id="`project-mtime-${project.id}`" class="project-mtime">
                            <wa-icon auto-width name="clock" variant="regular"></wa-icon>
                            <wa-relative-time v-if="useRelativeTime" :date.prop="timestampToDate(project.mtime)" :format="relativeTimeFormat" numeric="always" sync></wa-relative-time>
                            <span v-else>{{ formatDate(project.mtime) }}</span>
                        </span>
                        <AppTooltip :for="`project-mtime-${project.id}`">{{ useRelativeTime ? `Last activity: ${formatDate(project.mtime)}` : 'Last activity' }}</AppTooltip>
                    </div>
                    <div :id="`project-sparkline-${project.id}`" class="project-graph">
                        <ActivitySparkline :id-suffix="project.id" :data="store.weeklyActivity[project.id] || []" />
                    </div>
                    <AppTooltip :for="`project-sparkline-${project.id}`">Project activity (message turns per week)</AppTooltip>
                </div>
            </div>
        </wa-card>

        <!-- Children (rendered recursively) -->
        <div v-if="hasChildren && isOpen" class="tree-children">
            <ProjectTreeNode
                v-for="child in node.children"
                :key="child.project ? child.project.id : `folder-${child.segment}`"
                :node="child"
                @select="onChildSelect"
                @edit="onChildEdit"
            />
        </div>
    </div>
</template>

<style scoped>
.tree-node {
    display: flex;
    flex-direction: column;
}

.folder-header {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
    padding: var(--wa-space-xs) 0;
    cursor: pointer;
    user-select: none;
    color: var(--wa-color-text-quiet);
}

.folder-header:hover {
    color: var(--wa-color-text-default);
}

.folder-label {
    font-size: var(--wa-font-size-s);
    font-family: var(--wa-font-mono);
    font-weight: 500;
}

.chevron-icon {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    flex-shrink: 0;
}

.tree-chevron {
    cursor: pointer;
}

.tree-children {
    padding-left: var(--wa-space-m);
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
}

/* Project card styles — replicated from ProjectList.vue */
.project-card {
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    &::part(body) {
        position: relative;
    }
}

.project-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--wa-shadow-m);
}

.project-info {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
}

.project-title-row {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xl);
    padding-right: calc(var(--wa-space-s) + 1.5em);
}

.project-title {
    font-weight: 600;
    font-size: var(--wa-font-size-m);
    min-width: 0;
}

.edit-button {
    position: absolute;
    top: calc(var(--spacing) / 2);
    right: calc(var(--spacing) / 2);
}

.project-directory {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    word-break: break-all;
}

.project-meta-wrapper {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.project-meta {
    display: flex;
    justify-content: start;
    gap: var(--wa-space-m);
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);

    & > span {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
    }
}
</style>
