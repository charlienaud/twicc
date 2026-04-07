/**
 * Convention: when a workspace is used as an effectiveProjectId in the data store,
 * it is encoded as "ws:<workspaceId>". These helpers centralize this convention.
 */

export const WORKSPACE_PREFIX = 'ws:'

export function isWorkspaceProjectId(id) {
    return typeof id === 'string' && id.startsWith(WORKSPACE_PREFIX)
}

export function toWorkspaceProjectId(workspaceId) {
    return WORKSPACE_PREFIX + workspaceId
}

export function extractWorkspaceId(workspaceProjectId) {
    return workspaceProjectId.slice(WORKSPACE_PREFIX.length)
}
