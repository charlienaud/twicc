/**
 * Aggregate weekly activity data from multiple projects into a single array.
 * Sums user_message_count, session_count and cost per date across all projects.
 *
 * @param {string[]} projectIds - Project IDs to aggregate
 * @param {Object} weeklyActivity - Store's weeklyActivity map (projectId → array of entries)
 * @returns {Array<{date: string, user_message_count: number, session_count: number, cost: string}>}
 */
export function aggregateWeeklyActivity(projectIds, weeklyActivity) {
    const merged = {}
    for (const pid of projectIds) {
        const data = weeklyActivity[pid]
        if (!data) continue
        for (const entry of data) {
            if (!merged[entry.date]) {
                merged[entry.date] = {
                    date: entry.date,
                    user_message_count: 0,
                    session_count: 0,
                    cost: 0,
                }
            }
            const m = merged[entry.date]
            m.user_message_count += entry.user_message_count || 0
            m.session_count += entry.session_count || 0
            m.cost += parseFloat(entry.cost) || 0
        }
    }
    return Object.values(merged).sort((a, b) => a.date.localeCompare(b.date))
}
