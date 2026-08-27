export type StandardCallback<T> = (err?: ErrorInfo | null, result?: T) => void;
export type ErrCallback = (err?: ErrorInfo | null) => void;
export type PaginatedResultCallback<T> = StandardCallback<PaginatedResult<T>>;
/**
 * Use this to override specific property typings on an existing object type
 */
export type Modify<T, R> = Omit<T, keyof R> & R;
/**
 * Collects all keys from every member of a union into a single partial object type.
 * Allows uniform access to any field across a discriminated union.
 */
export type FlattenUnion<T> = {
  [K in T extends unknown ? keyof T : never]?: T extends unknown ? (K extends keyof T ? T[K] : never) : never;
};
