// The signature of clearTimeout varies between browser and NodeJS. This typing essentially just merges the two for compatibility.
declare function clearTimeout(timer?: NodeJS.Timeout | number | null): void;
