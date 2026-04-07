<script setup>
// WorkspaceManageDialog.vue - Dialog for managing workspaces (list + create/edit form)
import { ref, computed, nextTick, useId } from 'vue'
import { useWorkspacesStore } from '../stores/workspaces'
import { useSettingsStore } from '../stores/settings'
import { useDataStore } from '../stores/data'
import ProjectBadge from './ProjectBadge.vue'
import ProjectSelectOptions from './ProjectSelectOptions.vue'

const workspacesStore = useWorkspacesStore()
const settingsStore = useSettingsStore()
const dataStore = useDataStore()

// -- Dialog refs --------------------------------------------------------------
const dialogRef = ref(null)
const saveButtonRef = ref(null)
const nameInputRef = ref(null)

const instanceId = useId()
const formId = `manage-workspaces-form-${instanceId}`

// -- View state ---------------------------------------------------------------
const view = ref('list') // 'list' or 'form'
const errorMessage = ref('')
const deleteConfirmId = ref(null) // workspace ID pending delete confirmation
const localShowArchived = ref(false) // local toggle, independent from the global setting

// -- Form data (buffered until Save) -----------------------------------------
const formData = ref({
    id: null,          // null for create mode
    name: '',
    color: '',
    archived: false,
    projectIds: [],    // local copy, manipulated freely until save
})

// -- Computed -----------------------------------------------------------------
const dialogLabel = computed(() => {
    if (view.value === 'list') return 'Workspaces'
    if (formData.value.id) return 'Edit Workspace'
    return 'New Workspace'
})

/** Workspaces to display in the list, respecting the dialog-local "show archived" toggle. */
const visibleWorkspaces = computed(() => {
    const all = workspacesStore.getAllWorkspaces
    if (localShowArchived.value) return all
    return all.filter(w => !w.archived)
})

/** Projects available to add (not already in the form's projectIds, respecting archived setting). */
const availableProjects = computed(() => {
    const inSet = new Set(formData.value.projectIds)
    const showArchived = settingsStore.isShowArchivedProjects
    return dataStore.getProjects.filter(p => !inSet.has(p.id) && (showArchived || !p.archived))
})

// -- List view helpers --------------------------------------------------------
function handleReorder(fromIndex, toIndex) {
    workspacesStore.reorderWorkspace(fromIndex, toIndex)
}

function requestDelete(workspaceId) {
    deleteConfirmId.value = workspaceId
}

function cancelDelete() {
    deleteConfirmId.value = null
}

function confirmDelete(workspaceId) {
    workspacesStore.deleteWorkspace(workspaceId)
    deleteConfirmId.value = null
}

// -- Form helpers -------------------------------------------------------------
function openAddForm() {
    formData.value = {
        id: null,
        name: '',
        color: '',
        archived: false,
        projectIds: [],
    }
    errorMessage.value = ''
    view.value = 'form'
    nextTick(() => syncFormState())
}

function openEditForm(workspace) {
    formData.value = {
        id: workspace.id,
        name: workspace.name,
        color: workspace.color || '',
        archived: workspace.archived,
        projectIds: [...workspace.projectIds],
    }
    errorMessage.value = ''
    view.value = 'form'
    nextTick(() => syncFormState())
}

function cancelForm() {
    view.value = 'list'
    errorMessage.value = ''
}

// -- Project list manipulation (form) -----------------------------------------
function addProject(event) {
    const projectId = event.target.value
    if (!projectId) return
    if (!formData.value.projectIds.includes(projectId)) {
        formData.value.projectIds.push(projectId)
    }
    // Reset the select back to placeholder
    event.target.value = ''
}

function removeProject(index) {
    formData.value.projectIds.splice(index, 1)
}

function moveProjectUp(index) {
    if (index <= 0) return
    const ids = formData.value.projectIds
    ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
}

function moveProjectDown(index) {
    const ids = formData.value.projectIds
    if (index >= ids.length - 1) return
    ;[ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]
}

// -- Validation & save --------------------------------------------------------
function handleSave() {
    errorMessage.value = ''

    const trimmedName = formData.value.name.trim()

    if (!trimmedName) {
        errorMessage.value = 'Name is required.'
        return
    }

    if (trimmedName.length > 20) {
        errorMessage.value = 'Name must be 20 characters or less.'
        return
    }

    // Uniqueness check (exclude self when editing)
    const isDuplicate = workspacesStore.getAllWorkspaces.some(w => {
        if (formData.value.id && w.id === formData.value.id) return false
        return w.name.trim().toLowerCase() === trimmedName.toLowerCase()
    })
    if (isDuplicate) {
        errorMessage.value = 'A workspace with this name already exists.'
        return
    }

    const payload = {
        name: trimmedName,
        color: formData.value.color || null,
        projectIds: [...formData.value.projectIds],
        archived: formData.value.archived,
    }

    if (formData.value.id) {
        workspacesStore.updateWorkspace(formData.value.id, payload)
    } else {
        workspacesStore.createWorkspace(payload)
    }

    view.value = 'list'
    errorMessage.value = ''
}

// -- Dialog lifecycle ---------------------------------------------------------
function syncFormState() {
    nextTick(() => {
        if (saveButtonRef.value) {
            saveButtonRef.value.setAttribute('form', formId)
        }
    })
}

function focusFirstInput() {
    if (view.value === 'form' && nameInputRef.value) {
        nameInputRef.value.focus()
        const len = nameInputRef.value.value?.length || 0
        nameInputRef.value.setSelectionRange(len, len)
    }
}

// Guard dialog events against bubbling from child wa-select/wa-dropdown
function handleDialogShow(e) {
    if (e.target !== dialogRef.value) return
    syncFormState()
}

function handleDialogAfterShow(e) {
    if (e.target !== dialogRef.value) return
    focusFirstInput()
}

function handleDialogHide(e) {
    if (e.target !== dialogRef.value) return
    // Let the dialog close normally
}

function open() {
    view.value = 'list'
    errorMessage.value = ''
    deleteConfirmId.value = null
    localShowArchived.value = settingsStore.isShowArchivedWorkspaces
    if (dialogRef.value) {
        dialogRef.value.open = true
    }
}

function close() {
    if (dialogRef.value) {
        dialogRef.value.open = false
    }
}

function openForWorkspace(workspaceId) {
    const ws = workspacesStore.getWorkspaceById(workspaceId)
    if (!ws) {
        open()
        return
    }
    errorMessage.value = ''
    deleteConfirmId.value = null
    localShowArchived.value = settingsStore.isShowArchivedWorkspaces
    openEditForm(ws)
    if (dialogRef.value) {
        dialogRef.value.open = true
    }
}

function openNew() {
    errorMessage.value = ''
    deleteConfirmId.value = null
    localShowArchived.value = settingsStore.isShowArchivedWorkspaces
    openAddForm()
    if (dialogRef.value) {
        dialogRef.value.open = true
    }
}

defineExpose({ open, close, openForWorkspace, openNew })
</script>

<template>
    <wa-dialog
        ref="dialogRef"
        :label="dialogLabel"
        class="manage-workspaces-dialog"
        @wa-show="handleDialogShow"
        @wa-after-show="handleDialogAfterShow"
        @wa-hide="handleDialogHide"
    >
        <!-- === LIST VIEW === -->
        <div v-if="view === 'list'" class="dialog-content">
            <!-- Show archived toggle (local to dialog, does not affect global setting) -->
            <div v-if="workspacesStore.hasArchivedWorkspaces" class="archived-toggle">
                <wa-switch
                    :checked="localShowArchived"
                    @change="localShowArchived = $event.target.checked"
                    size="small"
                >
                    Show archived workspaces
                </wa-switch>
            </div>

            <!-- Workspace list -->
            <div class="workspace-list">
                <div
                    v-for="(workspace, index) in visibleWorkspaces"
                    :key="workspace.id"
                    class="workspace-row"
                >
                    <!-- Reorder arrows -->
                    <div class="reorder-arrows">
                        <button
                            class="reorder-btn"
                            :class="{ disabled: index === 0 }"
                            :disabled="index === 0"
                            @click="handleReorder(index, index - 1)"
                            title="Move up"
                        ><wa-icon name="chevron-up" /></button>
                        <button
                            class="reorder-btn"
                            :class="{ disabled: index === visibleWorkspaces.length - 1 }"
                            :disabled="index === visibleWorkspaces.length - 1"
                            @click="handleReorder(index, index + 1)"
                            title="Move down"
                        ><wa-icon name="chevron-down" /></button>
                    </div>

                    <!-- Display info -->
                    <div class="workspace-display">
                        <span class="workspace-name"><wa-icon name="layer-group" auto-width :style="workspace.color ? { color: workspace.color } : null"></wa-icon> {{ workspace.name }}</span>
                        <span class="workspace-project-count">
                            {{ workspace.projectIds.length }} project{{ workspace.projectIds.length !== 1 ? 's' : '' }}
                        </span>
                    </div>

                    <!-- Action buttons -->
                    <div class="workspace-actions">
                        <!-- Delete confirmation -->
                        <template v-if="deleteConfirmId === workspace.id">
                            <span class="delete-confirm-label">Delete?</span>
                            <button class="action-btn action-btn-danger" @click="confirmDelete(workspace.id)" title="Confirm delete">
                                <wa-icon name="check" />
                            </button>
                            <button class="action-btn" @click="cancelDelete" title="Cancel delete">
                                <wa-icon name="xmark" />
                            </button>
                        </template>
                        <template v-else>
                            <button class="action-btn" @click="openEditForm(workspace)" title="Edit">
                                <wa-icon name="pen-to-square" />
                            </button>
                            <button
                                class="action-btn"
                                @click="workspacesStore.updateWorkspace(workspace.id, { archived: !workspace.archived })"
                                :title="workspace.archived ? 'Unarchive' : 'Archive'"
                            >
                                <wa-icon :name="workspace.archived ? 'box-open' : 'box-archive'" :style="workspace.archived ? { color: 'var(--wa-color-warning-60)' } : null" />
                            </button>
                            <button class="action-btn action-btn-danger" @click="requestDelete(workspace.id)" title="Delete">
                                <wa-icon name="trash-can" />
                            </button>
                        </template>
                    </div>
                </div>
            </div>

            <!-- Empty state -->
            <div v-if="visibleWorkspaces.length === 0" class="empty-message">
                No workspaces yet. Create one to get started.
            </div>
        </div>

        <!-- === FORM VIEW === -->
        <form v-else :id="formId" class="dialog-content" @submit.prevent="handleSave">
            <!-- Name field -->
            <div class="form-group">
                <label class="form-label">Name</label>
                <wa-input
                    ref="nameInputRef"
                    :value="formData.name"
                    @input="formData.name = $event.target.value"
                    placeholder="e.g. &quot;Frontend work&quot;"
                    size="small"
                    maxlength="20"
                />
            </div>

            <!-- Color picker -->
            <div class="form-group">
                <label class="form-label">Color</label>
                <wa-color-picker
                    :value.prop="formData.color"
                    @change="formData.color = $event.target.value"
                ></wa-color-picker>
            </div>

            <!-- Project list -->
            <div class="form-group">
                <label class="form-label">Projects</label>

                <div v-if="formData.projectIds.length > 0" class="project-list">
                    <div
                        v-for="(pid, index) in formData.projectIds"
                        :key="pid"
                        class="project-row"
                    >
                        <!-- Reorder arrows -->
                        <div class="reorder-arrows">
                            <button
                                type="button"
                                class="reorder-btn"
                                :class="{ disabled: index === 0 }"
                                :disabled="index === 0"
                                @click="moveProjectUp(index)"
                                title="Move up"
                            ><wa-icon name="chevron-up" /></button>
                            <button
                                type="button"
                                class="reorder-btn"
                                :class="{ disabled: index === formData.projectIds.length - 1 }"
                                :disabled="index === formData.projectIds.length - 1"
                                @click="moveProjectDown(index)"
                                title="Move down"
                            ><wa-icon name="chevron-down" /></button>
                        </div>

                        <!-- Project badge -->
                        <div class="project-row-badge">
                            <ProjectBadge :project-id="pid" />
                        </div>

                        <!-- Remove button -->
                        <button
                            type="button"
                            class="action-btn action-btn-danger"
                            @click="removeProject(index)"
                            title="Remove project"
                        >
                            <wa-icon name="xmark" />
                        </button>
                    </div>
                </div>

                <div v-else class="empty-projects-message">
                    No projects added yet.
                </div>

                <!-- Add project select -->
                <wa-select
                    v-if="availableProjects.length > 0"
                    value=""
                    @change="addProject"
                    placeholder="Add a project..."
                    size="small"
                    class="add-project-select"
                >
                    <ProjectSelectOptions :projects="availableProjects" />
                </wa-select>
            </div>

            <!-- Error -->
            <wa-callout v-if="errorMessage" variant="danger" size="small">
                {{ errorMessage }}
            </wa-callout>
        </form>

        <!-- === FOOTER === -->
        <div slot="footer" class="dialog-footer">
            <template v-if="view === 'list'">
                <wa-button variant="neutral" appearance="outlined" @click="close">
                    Close
                </wa-button>
                <wa-button variant="brand" @click="openAddForm">
                    + New workspace
                </wa-button>
            </template>
            <template v-else>
                <wa-switch
                    :checked="formData.archived"
                    @change="formData.archived = $event.target.checked"
                    size="small"
                    class="footer-archived-switch"
                >
                    Archived
                </wa-switch>
                <wa-button variant="neutral" appearance="outlined" @click="cancelForm">
                    Cancel
                </wa-button>
                <wa-button ref="saveButtonRef" type="submit" variant="brand">
                    Save
                </wa-button>
            </template>
        </div>
    </wa-dialog>
</template>

<style scoped>
.manage-workspaces-dialog {
    --width: min(36rem, calc(100vw - 2rem));
}

.dialog-content {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
    button {
        box-shadow: none;
        margin: 0;
    }
}

/* -- Archived toggle -------------------------------------------------------- */
.archived-toggle {
    padding-bottom: var(--wa-space-2xs);
}

/* -- Empty state ------------------------------------------------------------ */
.empty-message {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    text-align: center;
    padding: var(--wa-space-l) 0;
}

.empty-projects-message {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    padding: var(--wa-space-xs) 0;
}

/* -- Workspace list --------------------------------------------------------- */
.workspace-list {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-3xs);
}

.workspace-row {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    background: var(--wa-color-surface-alt);
    border-radius: var(--wa-border-radius-m);
}

/* -- Reorder arrows (shared between list and form) -------------------------- */
.reorder-arrows {
    display: flex;
    gap: var(--wa-space-2xs);
    flex-shrink: 0;
}

.reorder-btn {
    background: none;
    border: none;
    color: var(--wa-color-text-quiet);
    font-size: var(--wa-font-size-xs);
    padding: var(--wa-space-2xs);
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s;
}

.reorder-btn:hover:not(.disabled) {
    color: var(--wa-color-text-base);
    background: var(--wa-color-surface-alt);
}

.reorder-btn.disabled {
    opacity: 0.25;
    cursor: default;
}

/* -- Workspace display ------------------------------------------------------ */
.workspace-display {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wa-space-xs);
}

.workspace-name {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
    color: var(--wa-color-brand-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    > wa-icon {
        margin-right: var(--wa-space-2xs);
    }
}

.archived-tag {
    font-size: var(--wa-font-size-2xs);
    color: var(--wa-color-text-quiet);
    background: var(--wa-color-surface-base);
    border: 1px solid var(--wa-color-border-quiet);
    border-radius: var(--wa-border-radius-s);
    padding: 0 var(--wa-space-2xs);
    white-space: nowrap;
    line-height: 1.6;
}

.workspace-project-count {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    white-space: nowrap;
    margin-left: auto;
}

/* -- Action buttons --------------------------------------------------------- */
.workspace-actions {
    display: flex;
    align-items: center;
    gap: var(--wa-space-3xs);
    flex-shrink: 0;
}

.delete-confirm-label {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-danger-text);
    white-space: nowrap;
}

.action-btn {
    background: none;
    border: none;
    font-size: var(--wa-font-size-m);
    padding: var(--wa-space-xs);
    cursor: pointer;
    line-height: 1;
    transition: background-color 0.15s, color 0.15s;
    color: var(--wa-color-text-quiet);
}

.action-btn:hover {
    background: var(--wa-color-surface-alt);
    color: var(--wa-color-text-base);
}

.action-btn-danger:hover {
    color: var(--wa-color-danger-text);
}

/* -- Form ------------------------------------------------------------------- */
.form-group {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-xs);
}

.form-label {
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-semibold);
}

/* -- Project list in form --------------------------------------------------- */
.project-list {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-3xs);
}

.project-row {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    background: var(--wa-color-surface-alt);
    border-radius: var(--wa-border-radius-m);
    padding: var(--wa-space-3xs) 0;
}

.project-row-badge {
    flex: 1;
    min-width: 0;
    overflow: hidden;
}

.add-project-select {
    max-width: 280px;
}

/* -- Footer ----------------------------------------------------------------- */
.dialog-footer {
    display: flex;
    flex-wrap: wrap;
    gap: var(--wa-space-s);
    justify-content: flex-end;
    width: 100%;
    align-items: center;
}

.footer-archived-switch {
    margin-right: auto;
}
</style>
