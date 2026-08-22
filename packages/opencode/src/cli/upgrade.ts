// Update checks are disabled in this deployment: the binary is maintained by
// an external scheduled task that pulls and rebuilds from the fork. The
// built-in upgrader would fight it (and silently reinstall upstream releases
// over the mod on patch versions), so this is an unconditional no-op.
export async function upgrade() {}
