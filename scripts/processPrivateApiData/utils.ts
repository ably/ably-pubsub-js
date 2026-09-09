import { PrivateApiUsageDto, Record, TestStartRecord } from './dto';
import { Group } from './grouping';
import { StaticContext } from './staticContext';

export function stripFilePrefix(records: Record[]) {
  for (const record of records) {
    if (record.context.file !== null) {
      record.context.file = record.context.file.replace('/home/runner/work/ably-pubsub-js/ably-pubsub-js/', '');
    }
  }
}

export function splittingRecords(records: Record[]) {
  return {
    testStartRecords: records.filter((record) => record.privateAPIIdentifier == null) as TestStartRecord[],
    usageDtos: records.filter((record) => record.privateAPIIdentifier !== null) as PrivateApiUsageDto[],
  };
}

export function percentageString(value: number, total: number) {
  return `${((100 * value) / total).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

/**
 * Puts the miscHelper usages (i.e. stuff that doesn’t have file info) first.
 */
export function sortStaticContextUsages(contextGroups: Group<StaticContext, PrivateApiUsageDto>[]) {
  const original = [...contextGroups];

  contextGroups.sort((a, b) => {
    if (a.key.type === 'miscHelper' && b.key.type !== 'miscHelper') {
      return -1;
    }

    if (a.key.type !== 'miscHelper' && b.key.type === 'miscHelper') {
      return 1;
    }

    return original.indexOf(a) - original.indexOf(b);
  });
}

export function joinComponents(components: { key: string; value: string }[]) {
  return components.map((pair) => `${pair.key}=${pair.value}`).join(';');
}
