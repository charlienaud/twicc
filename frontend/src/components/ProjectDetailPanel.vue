<script setup>
// ProjectDetailPanel.vue - Detail panel shown when no session is selected.
// Delegates header display to ProjectDetailHeader, then shows contribution graphs.

import { computed } from 'vue'
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
</script>

<template>
    <div class="project-detail-panel">
        <ProjectDetailHeader :project-id="projectId" />
        <div class="detail-content">
            <ContributionGraphs :project-id="projectId" :project-ids="workspaceProjectIds" />
        </div>
    </div>
</template>

<style scoped>
.project-detail-panel {
    container: project-detail / inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
    height: 100%;
    padding-top: var(--wa-space-s);
    width: 100%;
    overflow: hidden;
}

.detail-content {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding-bottom: 3rem;
}
</style>
