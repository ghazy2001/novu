import '../../src/config';

import {
  DalService,
  DIGEST_MASTER_GUARD_INDEX_KEY,
  DIGEST_MASTER_GUARD_INDEX_NAME,
  DIGEST_MASTER_GUARD_INDEX_OPTIONS,
  JobRepository,
} from '@novu/dal';

export interface JobIndexDescription {
  name?: string;
  key: Record<string, unknown>;
}

export type JobIndexCollection = {
  indexes: () => Promise<JobIndexDescription[]>;
  dropIndex: (name: string) => Promise<unknown>;
  createIndex: (key: Record<string, unknown>, options: Record<string, unknown>) => Promise<string>;
};

/**
 * True only for the stale definition: same index name but still keyed on the
 * external `subscriberId` string. Returns false for the corrected definition
 * (keyed on `_subscriberId`) so re-runs are safe no-ops for the drop step.
 */
export function isLegacyDigestMasterIndex(index: JobIndexDescription): boolean {
  if (index.name !== DIGEST_MASTER_GUARD_INDEX_NAME) {
    return false;
  }

  return index.key.subscriberId !== undefined && index.key._subscriberId === undefined;
}

/**
 * Drops the legacy guard index (same name, wrong key) and (re)creates it with
 * the corrected `_subscriberId` key. Safe to re-run: a missing index on drop
 * (code 27) is tolerated, and `createIndex` with an identical spec is a
 * no-op when the corrected index already exists.
 *
 * Run before relying on the new schema definition: with
 * `MONGO_AUTO_CREATE_INDEXES=true` MongoDB rejects a same-name,
 * different-key index at startup, and with it disabled the stale
 * `subscriberId` index would otherwise remain and keep rejecting inserts.
 */
export async function migrateJobDigestMasterIndex(collection: JobIndexCollection): Promise<{
  droppedLegacyIndex: boolean;
  createdIndexName: string;
}> {
  let droppedLegacyIndex = false;
  const indexes = await collection.indexes();

  if (indexes.some(isLegacyDigestMasterIndex)) {
    try {
      await collection.dropIndex(DIGEST_MASTER_GUARD_INDEX_NAME);
      droppedLegacyIndex = true;
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 27) {
        throw error;
      }
    }
  }

  const createdIndexName = await collection.createIndex(
    { ...DIGEST_MASTER_GUARD_INDEX_KEY },
    { ...DIGEST_MASTER_GUARD_INDEX_OPTIONS }
  );

  return { droppedLegacyIndex, createdIndexName };
}

export async function run() {
  console.log('Start migration - job delayed-digest master guard index to _subscriberId');

  if (!process.env.MONGO_URL) {
    throw new Error('MONGO_URL is not set');
  }

  const dalService = new DalService();
  // Disable automatic index creation on connect so schema registration cannot
  // race or conflict with the legacy index before the migration has dropped it.
  await dalService.connect(process.env.MONGO_URL, { autoIndex: false });

  try {
    const collection = new JobRepository()._model.collection;
    const result = await migrateJobDigestMasterIndex({
      indexes: () => collection.indexes(),
      dropIndex: (name: string) => collection.dropIndex(name),
      createIndex: (key: Record<string, unknown>, options: Record<string, unknown>) =>
        collection.createIndex(key, options),
    });

    console.log(
      `Migrated job digest master guard index: dropped legacy index: ${result.droppedLegacyIndex}, index: ${result.createdIndexName}`
    );
    console.log('End migration.');
  } finally {
    await dalService.disconnect();
  }
}

if (require.main === module) {
  run()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed', error);
      process.exit(1);
    });
}
