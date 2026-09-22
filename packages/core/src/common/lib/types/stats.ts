type StatsValues = {
  entries?: Partial<Record<string, number>>;
  schema?: string;
  appId?: string;
  inProgress?: never;
  unit?: never;
  intervalId?: never;
};

class Stats {
  entries?: Partial<Record<string, number>>;
  schema?: string;
  appId?: string;
  inProgress?: never;
  unit?: never;
  intervalId?: never;

  constructor(values?: StatsValues) {
    this.entries = (values && values.entries) || undefined;
    this.schema = (values && values.schema) || undefined;
    this.appId = (values && values.appId) || undefined;
    this.inProgress = (values && values.inProgress) || undefined;
    this.unit = (values && values.unit) || undefined;
    this.intervalId = (values && values.intervalId) || undefined;
  }

  static fromValues(values: StatsValues): Stats {
    return new Stats(values);
  }
}

export default Stats;
