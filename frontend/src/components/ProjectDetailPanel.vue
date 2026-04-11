<script setup>
// ProjectDetailPanel.vue - Detail panel shown when no session is selected.
// Delegates header display to ProjectDetailHeader, then shows tabbed content.

import { ref, computed } from 'vue'
import { useWorkspacesStore } from '../stores/workspaces'
import { isWorkspaceProjectId, extractWorkspaceId } from '../utils/workspaceIds'
import ProjectDetailHeader from './ProjectDetailHeader.vue'
import ContributionGraphs from './ContributionGraphs.vue'

const props = defineProps({
    /** Project ID or ALL_PROJECTS_ID for aggregate view */
    projectId: {
        type: String,
        required: true,
    },
})

const workspacesStore = useWorkspacesStore()

// Workspace project IDs (needed for ContributionGraphs)
const isWorkspaceMode = computed(() => isWorkspaceProjectId(props.projectId))
const workspaceId = computed(() => isWorkspaceMode.value ? extractWorkspaceId(props.projectId) : null)
const workspaceProjectIds = computed(() =>
    workspaceId.value ? workspacesStore.getVisibleProjectIds(workspaceId.value) : null
)

// Tab management
const activeTab = ref('stats')
const headerRef = ref(null)

const TABS = [
    { id: 'stats', label: 'Stats', icon: 'chart-simple' },
    { id: 'dummy', label: 'Dummy', icon: 'flask' },
]

const activeTabLabel = computed(() => {
    const tab = TABS.find(t => t.id === activeTab.value)
    return tab?.label ?? null
})

function switchToTab(tabId) {
    activeTab.value = tabId
}

function switchToTabAndCollapse(tabId) {
    switchToTab(tabId)
    if (headerRef.value?.isCompactExpanded) {
        headerRef.value.isCompactExpanded = false
    }
}

function onTabShow(event) {
    const panel = event.detail?.name
    if (panel) switchToTab(panel)
}
</script>

<template>
    <div class="project-detail-panel">
        <ProjectDetailHeader ref="headerRef" :project-id="projectId" :active-tab-label="activeTabLabel">
            <template #compact-extra>
                <div class="compact-tab-nav">
                    <wa-button
                        v-for="tab in TABS"
                        :key="tab.id"
                        size="small"
                        :variant="activeTab === tab.id ? 'brand' : 'neutral'"
                        :appearance="activeTab === tab.id ? 'outlined' : 'plain'"
                        @click="switchToTabAndCollapse(tab.id)"
                    >
                        <wa-icon :name="tab.icon" slot="prefix"></wa-icon>
                        {{ tab.label }}
                    </wa-button>
                </div>
            </template>
        </ProjectDetailHeader>

        <wa-divider></wa-divider>

        <wa-tab-group
            :active="activeTab"
            class="detail-tabs"
            @wa-tab-show="onTabShow"
        >
            <wa-tab v-for="tab in TABS" :key="tab.id" slot="nav" :panel="tab.id">
                <wa-button
                    :appearance="activeTab === tab.id ? 'outlined' : 'plain'"
                    :variant="activeTab === tab.id ? 'brand' : 'neutral'"
                    size="small"
                >
                    {{ tab.label }}
                </wa-button>
            </wa-tab>

            <wa-tab-panel name="stats">
                <ContributionGraphs :project-id="projectId" :project-ids="workspaceProjectIds" />
            </wa-tab-panel>

            <wa-tab-panel name="dummy">
                <div class="dummy-content">
                    <wa-icon name="flask" style="font-size: 2rem; opacity: 0.3;"></wa-icon>
                    <p>Dummy tab for testing</p>
                </div>
            </wa-tab-panel>
        </wa-tab-group>
    </div>
</template>

<style scoped>
.project-detail-panel {
    container: project-detail / inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    padding-top: var(--wa-space-s);
    width: 100%;
    overflow: hidden;
}

wa-divider {
    --spacing: 0;
    --width: 4px;
}

.detail-tabs {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    --indicator-color: transparent;
    --track-width: 4px;
}

.detail-tabs::part(base) {
    height: 100%;
    overflow: hidden;
}

.detail-tabs::part(body) {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.detail-tabs :deep(wa-tab-panel::part(base)) {
    padding: 0;
}

wa-tab::part(base) {
    padding: var(--wa-space-xs);
}

.detail-tabs :deep(wa-tab-panel[active]) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.detail-tabs :deep(wa-tab-panel[active])::part(base) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding-bottom: 3rem;
}

.dummy-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--wa-space-m);
    padding: var(--wa-space-xl);
    color: var(--wa-color-text-quiet);
}

/* Compact tab nav: hidden by default, shown in compact overlay */
.compact-tab-nav {
    display: none;
}

@media (max-height: 900px) {
    .project-detail-panel {
        padding-top: 0;
    }

    /* Hide the divider and normal tab-group nav */
    wa-divider {
        display: none;
    }

    .detail-tabs::part(nav) {
        display: none;
    }

    /* Show the compact tab nav inside the header overlay */
    .compact-tab-nav {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        padding-inline: var(--wa-space-xs);
        padding-bottom: var(--wa-space-xs);
    }
}
</style>
