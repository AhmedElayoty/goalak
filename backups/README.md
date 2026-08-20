# Backups

Snapshots of every user's data from the textdb store: accounts, predictions, fantasy squads
and push subscriptions.

    node scripts-backup.mjs                            take a snapshot
    node scripts-backup.mjs --restore backups/FILE     dry run — show what would change
    node scripts-backup.mjs --restore backups/FILE --apply    write it back

**Restore is dry-run by default**, and refuses to write an empty snapshot value over live data
unless `--force` is given. A backup that fails to read even one key writes nothing at all — a
snapshot with holes is worse than no snapshot, because it looks like one and restores the holes.

Take one before any change to the storage format, and on a schedule while a season is running.
