/**
 * Split and sort projects for workspace-first display.
 *
 * @param {Array} projects - All projects to display
 * @param {Array|null} priorityProjectIds - Ordered array of workspace project IDs (null = no workspace)
 * @param {Set|null} visibleProjectIdSet - Set of visible project IDs within workspace (null = use all from priorityProjectIds)
 * @returns {{ prioritized: Array, others: Array }} Two arrays: workspace projects (in custom order), then the rest
 */
export function splitProjectsByPriority(projects, priorityProjectIds, visibleProjectIdSet = null) {
    if (!priorityProjectIds?.length) {
        return { prioritized: [], others: projects }
    }

    const prioritySet = visibleProjectIdSet || new Set(priorityProjectIds)
    const othersMap = new Map(projects.map(p => [p.id, p]))

    // Build prioritized list in workspace custom order, only including visible ones
    const prioritized = []
    for (const pid of priorityProjectIds) {
        if (!prioritySet.has(pid)) continue
        const project = othersMap.get(pid)
        if (project) {
            prioritized.push(project)
            othersMap.delete(pid)
        }
    }

    return { prioritized, others: Array.from(othersMap.values()) }
}
