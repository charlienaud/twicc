<script setup>
// ProjectDetailPanel.vue - Detail panel shown when no session is selected.
// Delegates header display to ProjectDetailHeader, then shows tabbed content.

import { ref, computed, watchEffect, onActivated, onDeactivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ALL_PROJECTS_ID, useDataStore } from '../stores/data'
import { useWorkspacesStore } from '../stores/workspaces'
import { isWorkspaceProjectId, extractWorkspaceId } from '../utils/workspaceIds'
import ProjectDetailHeader from './ProjectDetailHeader.vue'
import { apiFetch } from '../utils/api'
import ContributionGraphs from './ContributionGraphs.vue'
import FilesPanel from './FilesPanel.vue'
import TerminalPanel from './TerminalPanel.vue'

const props = defineProps({
    /** Project ID or ALL_PROJECTS_ID for aggregate view */
    projectId: {
        type: String,
        required: true,
    },
    /** Whether this panel is currently visible (not hidden behind a session view) */
    active: {
        type: Boolean,
        default: true,
    },
})

const dataStore = useDataStore()
const workspacesStore = useWorkspacesStore()
const route = useRoute()
const router = useRouter()

// KeepAlive lifecycle — track whether this instance is active (not cached)
const isKeptAlive = ref(true)
onActivated(() => { isKeptAlive.value = true })
onDeactivated(() => { isKeptAlive.value = false })

// Effective active state: visible AND not deactivated by KeepAlive
const isActive = computed(() => props.active && isKeptAlive.value)

// Mode detection — needed by terminal, files, and tab management sections
const isWorkspaceMode = computed(() => isWorkspaceProjectId(props.projectId))
const isAllProjectsMode = computed(() => route.name?.startsWith('projects-'))
const workspaceId = computed(() => isWorkspaceMode.value ? extractWorkspaceId(props.projectId) : null)
const workspaceProjectIds = computed(() =>
    workspaceId.value ? workspacesStore.getVisibleProjectIds(workspaceId.value) : null
)

const terminalContextKey = computed(() => {
    if (props.projectId === ALL_PROJECTS_ID) {
        return 'global'
    }
    if (isWorkspaceProjectId(props.projectId)) {
        return `w:${extractWorkspaceId(props.projectId)}`
    }
    return `p:${props.projectId}`
})

// For project terminals, pass the real project ID (not workspace/all-projects pseudo-IDs)
const terminalProjectId = computed(() => {
    if (props.projectId === ALL_PROJECTS_ID || isWorkspaceProjectId(props.projectId)) {
        return null
    }
    return props.projectId
})

// For workspace terminals, compute the lowest common ancestor of all project directories
const terminalCwd = computed(() => {
    if (!isWorkspaceMode.value || !workspaceProjectIds.value) return null
    const dirs = workspaceProjectIds.value
        .map(pid => dataStore.getProject(pid))
        .map(p => p?.directory)
        .filter(Boolean)
    if (dirs.length === 0) return null
    if (dirs.length === 1) return dirs[0]
    // Find the longest common path prefix
    const parts = dirs.map(d => d.split('/'))
    const common = []
    for (let i = 0; i < parts[0].length; i++) {
        const segment = parts[0][i]
        if (parts.every(p => p[i] === segment)) {
            common.push(segment)
        } else {
            break
        }
    }
    return common.length > 1 ? common.join('/') : '/'
})

const homeDir = ref(null)

watchEffect(async () => {
    if (props.projectId === ALL_PROJECTS_ID && !homeDir.value) {
        try {
            const res = await apiFetch('/api/home-directory/')
            if (res.ok) {
                const data = await res.json()
                homeDir.value = data.path
            }
        } catch { /* ignore */ }
    }
})

// For project files, pass the real project ID (not workspace/all-projects pseudo-IDs)
const filesProjectId = computed(() => {
    if (props.projectId === ALL_PROJECTS_ID || isWorkspaceProjectId(props.projectId)) return null
    return props.projectId
})

const filesApiPrefix = computed(() => {
    // Single project mode: use project-scoped endpoints (browsing restricted via validate_path)
    if (!isAllProjectsMode.value && !isWorkspaceMode.value) {
        return `/api/projects/${props.projectId}`
    }
    // All-projects and workspace modes: use standalone endpoints (restricted via ?root= param)
    return '/api'
})

const filesRootRestriction = computed(() => {
    // Project mode: restriction handled by validate_path, no need for ?root=
    if (!isAllProjectsMode.value && !isWorkspaceMode.value) return null
    // All-projects mode: restrict to $HOME
    if (props.projectId === ALL_PROJECTS_ID) return homeDir.value
    // Workspace mode: restrict to LCA
    return terminalCwd.value
})

const filesAvailableRoots = computed(() => {
    // All-projects mode
    if (props.projectId === ALL_PROJECTS_ID) {
        if (!homeDir.value) return []
        return [{ key: 'home', label: 'Home directory', path: homeDir.value }]
    }

    // Workspace mode
    if (isWorkspaceMode.value) {
        const roots = []
        const lca = terminalCwd.value  // reuse the LCA already computed for terminal
        if (!lca) return []
        roots.push({ key: 'common', label: 'Common directory', path: lca })

        // Add unique project directories that differ from LCA
        const seen = new Set([lca])
        const projectEntries = []
        for (const pid of workspaceProjectIds.value || []) {
            const project = dataStore.getProject(pid)
            const dir = project?.directory
            if (!dir || seen.has(dir)) continue
            seen.add(dir)
            projectEntries.push({
                key: `p:${pid}`,
                label: project.name || dir.split('/').pop(),
                path: dir,
            })
        }
        projectEntries.sort((a, b) => a.label.localeCompare(b.label))
        roots.push(...projectEntries)
        return roots
    }

    // Single project mode
    const project = dataStore.getProject(props.projectId)
    if (!project?.directory) return []
    const roots = [{ key: 'directory', label: 'Project directory', path: project.directory }]
    if (project.git_root && project.git_root !== project.directory) {
        roots.push({ key: 'git', label: 'Git root', path: project.git_root })
    }
    return roots
})

// Tab management — derived from route (like SessionView)
const headerRef = ref(null)

const TABS = [
    { id: 'stats', label: 'Stats', icon: 'chart-simple' },
    { id: 'files', label: 'Files', icon: 'folder-open' },
    { id: 'terminal', label: 'Terminal', icon: 'terminal' },
]

// Active tab derived from the route name
const activeTab = computed(() => {
    const name = route.name
    if (name === 'project-files' || name === 'projects-files') return 'files'
    if (name === 'project-terminal' || name === 'projects-terminal') return 'terminal'
    return 'stats'
})

const activeTabLabel = computed(() => {
    const tab = TABS.find(t => t.id === activeTab.value)
    return tab?.label ?? null
})

function switchToTab(tabId) {
    if (tabId === activeTab.value) return
    if (tabId === 'files') {
        router.push({
            name: isAllProjectsMode.value ? 'projects-files' : 'project-files',
            params: isAllProjectsMode.value ? {} : { projectId: props.projectId },
            query: route.query,
        })
    } else if (tabId === 'terminal') {
        router.push({
            name: isAllProjectsMode.value ? 'projects-terminal' : 'project-terminal',
            params: isAllProjectsMode.value ? {} : { projectId: props.projectId },
            query: route.query,
        })
    } else {
        // Stats = default route (no suffix)
        router.push({
            name: isAllProjectsMode.value ? 'projects-all' : 'project',
            params: isAllProjectsMode.value ? {} : { projectId: props.projectId },
            query: route.query,
        })
    }
}

function switchToTabAndCollapse(tabId) {
    switchToTab(tabId)
    if (headerRef.value?.isCompactExpanded) {
        headerRef.value.isCompactExpanded = false
    }
}

function onTabShow(event) {
    const panel = event.detail?.name
    // Only handle events from our own tabs (not from nested tab-groups like TerminalPanel's)
    if (panel && TABS.some(t => t.id === panel)) switchToTab(panel)
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

            <wa-tab-panel name="files">
                <FilesPanel
                    :api-prefix="filesApiPrefix"
                    :project-id="filesProjectId"
                    :root-restriction="filesRootRestriction"
                    :external-roots="filesAvailableRoots"
                    :active="isActive && activeTab === 'files'"
                />
            </wa-tab-panel>

            <wa-tab-panel name="terminal">
                <TerminalPanel
                    :context-key="terminalContextKey"
                    :project-id="terminalProjectId"
                    :cwd="terminalCwd"
                    :active="isActive && activeTab === 'terminal'"
                />
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
}

.detail-tabs :deep(wa-tab-panel[name="files"])::part(base),
.detail-tabs :deep(wa-tab-panel[name="terminal"])::part(base) {
    overflow-y: hidden;
    padding-bottom: 0;
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
