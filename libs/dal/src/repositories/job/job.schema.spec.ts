import { expect } from 'chai';

import {
  DIGEST_MASTER_GUARD_INDEX_KEY,
  DIGEST_MASTER_GUARD_INDEX_NAME,
  DIGEST_MASTER_GUARD_INDEX_OPTIONS,
  jobSchema,
} from './job.schema';

describe('Job Schema - Digest Master Guard Index', () => {
  it('defines the guard index name and options correctly', () => {
    expect(DIGEST_MASTER_GUARD_INDEX_NAME).to.equal(
      'Guard from having two master jobs for same digest key, digest value, workflow and subscriber'
    );
    expect(DIGEST_MASTER_GUARD_INDEX_OPTIONS.unique).to.equal(true);
    expect(DIGEST_MASTER_GUARD_INDEX_OPTIONS.partialFilterExpression).to.deep.include({
      status: 'delayed',
      type: 'digest',
    });
  });

  it('keys on internal _subscriberId and excludes external subscriberId', () => {
    expect(DIGEST_MASTER_GUARD_INDEX_KEY).to.have.property('_subscriberId', 1);
    expect(DIGEST_MASTER_GUARD_INDEX_KEY).to.not.have.property('subscriberId');
  });

  it('registers the index with _subscriberId on jobSchema', () => {
    const indexes = jobSchema.indexes();
    const guardIndex = indexes.find(([, options]) => options && options.name === DIGEST_MASTER_GUARD_INDEX_NAME);

    expect(guardIndex).to.be.an('array');
    const [keys, options] = guardIndex!;
    expect(keys).to.deep.equal(DIGEST_MASTER_GUARD_INDEX_KEY);
    expect(options).to.deep.include({
      name: DIGEST_MASTER_GUARD_INDEX_NAME,
      unique: true,
    });
  });
});
