/**
 * Static commands — registered once at app startup from App.vue.
 *
 * These commands don't depend on component lifecycle; they rely only on
 * store state, route state, and the router instance.
 *
 * Categories covered: navigation, creation, display, claude, ui.
 */

import { useCommandRegistry } from '../composables/useCommandRegistry'
import { useSettingsStore, getModelRegistry } from '../stores/settings'
import { useDataStore } from '../stores/data'
import { useWorkspacesStore } from '../stores/workspaces'
import { useRoute } from 'vue-router'
import { clearTabRouteParams } from '../utils/granularRoutes'
import {
    DISPLAY_MODE,
    COLOR_SCHEME,
    PERMISSION_MODE,
    PERMISSION_MODE_LABELS,
    EFFORT,
    EFFORT_LABELS,
    THINKING,
    THINKING_LABELS,
    CONTEXT_MAX,
    CONTEXT_MAX_LABELS,
    getModelLabel,
} from '../constants'

/**
 * Register all static commands.
 * Called once during app setup in App.vue.
 * @param {import('vue-router').Router} router
 */
export function initStaticCommands(router) {
    const { registerCommands } = useCommandRegistry()
    const settings = useSettingsStore()
    const data = useDataStore()
    const workspaces = useWorkspacesStore()
    const route = useRoute()

    // ── Helpers ────────────────────────────────────────────────────────────

    /** Whether the current route is in "all projects" mode */
    function isAllProjectsMode() {
        return route.name?.startsWith('projects-')
    }

    /** Session ID from the current route (if any) */
    function routeSessionId() {
        return route.params.sessionId || null
    }

    /** Project ID from the current route (if any) */
    function routeProjectId() {
        return route.params.projectId || null
    }

    const PROJECT_DETAIL_ROUTES = new Set([
        'project', 'project-files', 'project-git', 'project-terminal',
        'projects-all', 'projects-files', 'projects-git', 'projects-terminal',
    ])

    /** Whether the current route is on a project detail panel (not a session) */
    function isOnProjectDetail() {
        return PROJECT_DETAIL_ROUTES.has(route.name)
    }

    /** Non-archived projects sorted by display name */
    function activeProjects() {
        return data.getProjects.filter(p => !p.archived)
    }

    // ── Display mode labels ───────────────────────────────────────────────

    const DISPLAY_MODE_LABELS = {
        [DISPLAY_MODE.CONVERSATION]: 'Conversation',
        [DISPLAY_MODE.SIMPLIFIED]: 'Simplified',
        [DISPLAY_MODE.NORMAL]: 'Normal',
        [DISPLAY_MODE.DEBUG]: 'Debug',
    }

    // ── Color scheme labels ────────────────────────────────────────────────

    const COLOR_SCHEME_LABELS = {
        [COLOR_SCHEME.SYSTEM]: 'System',
        [COLOR_SCHEME.LIGHT]: 'Light',
        [COLOR_SCHEME.DARK]: 'Dark',
    }

    // ── Commands ──────────────────────────────────────────────────────────

    registerCommands([

        // ── Navigation ────────────────────────────────────────────────

        {
            id: 'nav.home',
            label: 'Go to Home',
            icon: 'house',
            category: 'navigation',
            action: () => router.push({ name: 'home' }),
        },
        {
            id: 'nav.project',
            label: 'Go to Project\u2026',
            icon: 'folder',
            category: 'navigation',
            items: () => activeProjects().map(p => ({
                id: p.id,
                label: data.getProjectDisplayName(p.id),
                action: () => router.push({ name: 'project', params: { projectId: p.id } }),
            })),
        },
        {
            id: 'nav.session',
            label: 'Go to Session\u2026',
            icon: 'message',
            category: 'navigation',
            items: () => {
                const projectId = routeProjectId()
                const sessions = (isAllProjectsMode() || !projectId
                    ? data.getAllSessions
                    : data.getProjectSessions(projectId)
                ).filter(s => !s.draft).slice(0, 100)
                return sessions.map(s => ({
                    id: s.id,
                    label: s.title || s.id,
                    action: () => {
                        const prefix = isAllProjectsMode() ? 'projects-session' : 'session'
                        router.push({
                            name: prefix,
                            params: { projectId: s.project_id, sessionId: s.id },
                        })
                    },
                }))
            },
        },
        {
            id: 'nav.all-projects',
            label: 'Go to All Projects',
            icon: 'layer-group',
            category: 'navigation',
            action: () => router.push({ name: 'projects-all' }),
        },
        {
            id: 'nav.workspace',
            label: 'Go to Workspace\u2026',
            icon: 'layer-group',
            category: 'navigation',
            items: () => workspaces.getSelectableWorkspaces.map(ws => ({
                id: ws.id,
                label: ws.name,
                action: () => router.push({ name: 'projects-all', query: { workspace: ws.id } }),
            })),
        },
        {
            id: 'nav.search',
            label: 'Search Sessions\u2026',
            icon: 'magnifying-glass',
            category: 'navigation',
            action: () => window.dispatchEvent(new CustomEvent('twicc:open-search')),
        },
        {
            id: 'nav.find-in-session',
            label: 'Search in Session\u2026',
            icon: 'magnifying-glass',
            category: 'navigation',
            when: () => route.name === 'session' || route.name === 'projects-session',
            action: () => window.dispatchEvent(new Event('twicc:toggle-session-search')),
        },
        {
            id: 'nav.tab.chat',
            label: 'Switch to Chat Tab',
            icon: 'comment',
            category: 'navigation',
            when: () => !!routeSessionId(),
            action: () => {
                const name = isAllProjectsMode() ? 'projects-session' : 'session'
                router.push({
                    name,
                    params: clearTabRouteParams('files', {
                        projectId: route.params.projectId,
                        sessionId: route.params.sessionId,
                    }),
                    query: route.query,
                })
            },
        },
        {
            id: 'nav.tab.files',
            label: 'Switch to Files Tab',
            icon: 'file-code',
            category: 'navigation',
            when: () => !!routeSessionId(),
            action: () => {
                const name = isAllProjectsMode() ? 'projects-session-files' : 'session-files'
                router.push({
                    name,
                    params: clearTabRouteParams('git', {
                        projectId: route.params.projectId,
                        sessionId: route.params.sessionId,
                    }),
                    query: route.query,
                })
            },
        },
        {
            id: 'nav.tab.git',
            label: 'Switch to Git Tab',
            icon: 'code-branch',
            category: 'navigation',
            when: () => {
                const sessionId = routeSessionId()
                if (!sessionId) return false
                const session = data.getSession(sessionId)
                if (!session) return false
                // Show when session has git info or the project has a git root
                return (!!session.git_directory && !!session.git_branch)
                    || !!data.getProject(session.project_id)?.git_root
            },
            action: () => {
                const name = isAllProjectsMode() ? 'projects-session-git' : 'session-git'
                router.push({
                    name,
                    params: clearTabRouteParams('terminal', {
                        projectId: route.params.projectId,
                        sessionId: route.params.sessionId,
                    }),
                    query: route.query,
                })
            },
        },
        {
            id: 'nav.tab.terminal',
            label: 'Switch to Terminal Tab',
            icon: 'terminal',
            category: 'navigation',
            when: () => !!routeSessionId(),
            action: () => {
                const name = isAllProjectsMode() ? 'projects-session-terminal' : 'session-terminal'
                router.push({
                    name,
                    params: {
                        projectId: route.params.projectId,
                        sessionId: route.params.sessionId,
                    },
                    query: route.query,
                })
            },
        },

        // Project detail panel tabs
        {
            id: 'nav.project-tab.stats',
            label: 'Switch to Stats Tab',
            icon: 'chart-line',
            category: 'navigation',
            when: () => isOnProjectDetail(),
            action: () => {
                const name = isAllProjectsMode() ? 'projects-all' : 'project'
                router.push({
                    name,
                    params: clearTabRouteParams('files', isAllProjectsMode() ? {} : { projectId: route.params.projectId }),
                    query: route.query,
                })
            },
        },
        {
            id: 'nav.project-tab.files',
            label: 'Switch to Files Tab (Project)',
            icon: 'file-code',
            category: 'navigation',
            when: () => isOnProjectDetail(),
            action: () => {
                const name = isAllProjectsMode() ? 'projects-files' : 'project-files'
                router.push({
                    name,
                    params: clearTabRouteParams('git', isAllProjectsMode() ? {} : { projectId: route.params.projectId }),
                    query: route.query,
                })
            },
        },
        {
            id: 'nav.project-tab.git',
            label: 'Switch to Git Tab (Project)',
            icon: 'code-branch',
            category: 'navigation',
            when: () => {
                if (!isOnProjectDetail()) return false
                // Git tab only available in single-project mode with a git root
                const projectId = routeProjectId()
                if (!projectId) return false
                return !!data.getProject(projectId)?.git_root
            },
            action: () => {
                const name = isAllProjectsMode() ? 'projects-git' : 'project-git'
                router.push({
                    name,
                    params: clearTabRouteParams('terminal', isAllProjectsMode() ? {} : { projectId: route.params.projectId }),
                    query: route.query,
                })
            },
        },
        {
            id: 'nav.project-tab.terminal',
            label: 'Switch to Terminal Tab (Project)',
            icon: 'terminal',
            category: 'navigation',
            when: () => isOnProjectDetail(),
            action: () => {
                const name = isAllProjectsMode() ? 'projects-terminal' : 'project-terminal'
                router.push({
                    name,
                    params: isAllProjectsMode() ? {} : { projectId: route.params.projectId },
                    query: route.query,
                })
            },
        },

        // ── Creation ──────────────────────────────────────────────────

        {
            id: 'create.session',
            label: 'New Session',
            icon: 'plus',
            category: 'creation',
            when: () => !!routeProjectId(),
            action: () => {
                const projectId = routeProjectId()
                const sessionId = data.createDraftSession(projectId)
                const name = isAllProjectsMode() ? 'projects-session' : 'session'
                router.push({ name, params: { projectId, sessionId } })
            },
        },
        {
            id: 'create.session-in',
            label: 'New Session in\u2026',
            icon: 'square-plus',
            category: 'creation',
            items: () => activeProjects().map(p => ({
                id: p.id,
                label: data.getProjectDisplayName(p.id),
                action: () => {
                    const sessionId = data.createDraftSession(p.id)
                    router.push({ name: 'session', params: { projectId: p.id, sessionId } })
                },
            })),
        },
        {
            id: 'create.project',
            label: 'New Project',
            icon: 'folder-plus',
            category: 'creation',
            action: () => {
                window.dispatchEvent(new CustomEvent('twicc:open-new-project-dialog'))
            },
        },
        {
            id: 'create.workspace',
            label: 'New Workspace',
            icon: 'layer-group',
            category: 'creation',
            action: () => {
                window.dispatchEvent(new CustomEvent('twicc:open-new-workspace-dialog'))
            },
        },

        // ── Display ───────────────────────────────────────────────────

        {
            id: 'display.color-scheme',
            label: 'Change Color Scheme\u2026',
            icon: 'circle-half-stroke',
            category: 'display',
            items: () => [
                { id: COLOR_SCHEME.SYSTEM, label: COLOR_SCHEME_LABELS[COLOR_SCHEME.SYSTEM], action: () => settings.setColorScheme(COLOR_SCHEME.SYSTEM), active: settings.colorScheme === COLOR_SCHEME.SYSTEM },
                { id: COLOR_SCHEME.LIGHT, label: COLOR_SCHEME_LABELS[COLOR_SCHEME.LIGHT], action: () => settings.setColorScheme(COLOR_SCHEME.LIGHT), active: settings.colorScheme === COLOR_SCHEME.LIGHT },
                { id: COLOR_SCHEME.DARK, label: COLOR_SCHEME_LABELS[COLOR_SCHEME.DARK], action: () => settings.setColorScheme(COLOR_SCHEME.DARK), active: settings.colorScheme === COLOR_SCHEME.DARK },
            ],
        },
        {
            id: 'display.mode',
            label: 'Change Display Mode\u2026',
            icon: 'eye',
            category: 'display',
            items: () => [
                { id: DISPLAY_MODE.CONVERSATION, label: DISPLAY_MODE_LABELS[DISPLAY_MODE.CONVERSATION], action: () => settings.setDisplayMode(DISPLAY_MODE.CONVERSATION), active: settings.displayMode === DISPLAY_MODE.CONVERSATION },
                { id: DISPLAY_MODE.SIMPLIFIED, label: DISPLAY_MODE_LABELS[DISPLAY_MODE.SIMPLIFIED], action: () => settings.setDisplayMode(DISPLAY_MODE.SIMPLIFIED), active: settings.displayMode === DISPLAY_MODE.SIMPLIFIED },
                { id: DISPLAY_MODE.NORMAL, label: DISPLAY_MODE_LABELS[DISPLAY_MODE.NORMAL], action: () => settings.setDisplayMode(DISPLAY_MODE.NORMAL), active: settings.displayMode === DISPLAY_MODE.NORMAL },
                { id: DISPLAY_MODE.DEBUG, label: DISPLAY_MODE_LABELS[DISPLAY_MODE.DEBUG], action: () => settings.setDisplayMode(DISPLAY_MODE.DEBUG), active: settings.displayMode === DISPLAY_MODE.DEBUG },
            ],
        },
        {
            id: 'display.toggle-costs',
            label: 'Toggle Show Costs',
            icon: 'coins',
            category: 'display',
            toggled: () => settings.areCostsShown,
            action: () => settings.setShowCosts(!settings.showCosts),
        },
        {
            id: 'display.toggle-compact',
            label: 'Toggle Compact Session List',
            icon: 'bars',
            category: 'display',
            toggled: () => settings.isCompactSessionList,
            action: () => settings.setCompactSessionList(!settings.compactSessionList),
        },
        {
            id: 'display.font-increase',
            label: 'Increase Font Size',
            icon: 'magnifying-glass-plus',
            category: 'display',
            action: () => settings.setFontSize(Math.min(settings.fontSize + 1, 32)),
        },
        {
            id: 'display.font-decrease',
            label: 'Decrease Font Size',
            icon: 'magnifying-glass-minus',
            category: 'display',
            action: () => settings.setFontSize(Math.max(settings.fontSize - 1, 12)),
        },
        {
            id: 'display.toggle-word-wrap',
            label: 'Toggle Editor Word Wrap',
            icon: 'text-width',
            category: 'display',
            toggled: () => settings.isEditorWordWrap,
            action: () => settings.setEditorWordWrap(!settings.editorWordWrap),
        },
        {
            id: 'display.toggle-show-diffs',
            label: 'Toggle Auto Open Live Edit Diffs',
            icon: 'code-compare',
            category: 'display',
            toggled: () => settings.isShowDiffs,
            action: () => settings.setShowDiffs(!settings.showDiffs),
        },
        {
            id: 'display.toggle-diff-layout',
            label: 'Toggle Side-by-Side Diff',
            icon: 'columns',
            category: 'display',
            toggled: () => settings.isDiffSideBySide,
            action: () => settings.setDiffSideBySide(!settings.diffSideBySide),
        },

        // ── Claude Defaults ───────────────────────────────────────────

        {
            id: 'claude.model',
            label: 'Change Default Model\u2026',
            icon: 'robot',
            category: 'claude',
            items: () => getModelRegistry().map(entry => ({
                id: entry.selectedModel,
                label: entry.latest
                    ? `${getModelLabel(entry.selectedModel)} (latest: ${entry.version})`
                    : `${getModelLabel(entry.selectedModel)} (until ${entry.retirementDate})`,
                action: () => settings.setDefaultModel(entry.selectedModel),
                active: settings.defaultModel === entry.selectedModel,
            })),
        },
        {
            id: 'claude.effort',
            label: 'Change Default Effort\u2026',
            icon: 'gauge',
            category: 'claude',
            items: () => Object.values(EFFORT).map(value => ({
                id: value,
                label: EFFORT_LABELS[value],
                action: () => settings.setDefaultEffort(value),
                active: settings.defaultEffort === value,
            })),
        },
        {
            id: 'claude.permission',
            label: 'Change Default Permission Mode\u2026',
            icon: 'shield-halved',
            category: 'claude',
            items: () => Object.values(PERMISSION_MODE).map(value => ({
                id: value,
                label: PERMISSION_MODE_LABELS[value],
                action: () => settings.setDefaultPermissionMode(value),
                active: settings.defaultPermissionMode === value,
            })),
        },
        {
            id: 'claude.thinking',
            label: 'Change Default Thinking\u2026',
            icon: 'brain',
            category: 'claude',
            items: () => [
                { id: 'enabled', label: THINKING_LABELS[THINKING.ENABLED], action: () => settings.setDefaultThinking(THINKING.ENABLED), active: settings.defaultThinking === THINKING.ENABLED },
                { id: 'disabled', label: THINKING_LABELS[THINKING.DISABLED], action: () => settings.setDefaultThinking(THINKING.DISABLED), active: settings.defaultThinking === THINKING.DISABLED },
            ],
        },
        {
            id: 'claude.context',
            label: 'Change Default Context Size\u2026',
            icon: 'window-maximize',
            category: 'claude',
            items: () => Object.values(CONTEXT_MAX).map(value => ({
                id: String(value),
                label: CONTEXT_MAX_LABELS[value],
                action: () => settings.setDefaultContextMax(value),
                active: settings.defaultContextMax === value,
            })),
        },

        // ── UI ────────────────────────────────────────────────────────

        {
            id: 'ui.manage-workspaces',
            label: 'Manage Workspaces',
            icon: 'layer-group',
            category: 'ui',
            action: () => {
                window.dispatchEvent(new CustomEvent('twicc:open-manage-workspaces-dialog'))
            },
        },
        {
            id: 'ui.edit-workspace',
            label: 'Edit Current Workspace',
            icon: 'pencil',
            category: 'ui',
            when: () => !!route.query.workspace,
            action: () => {
                window.dispatchEvent(new CustomEvent('twicc:open-edit-workspace-dialog', { detail: { workspaceId: route.query.workspace } }))
            },
        },
        {
            id: 'ui.settings',
            label: 'Open Settings',
            icon: 'gear',
            category: 'ui',
            action: () => {
                document.querySelector('#settings-trigger')?.click()
            },
        },
    ])
}
