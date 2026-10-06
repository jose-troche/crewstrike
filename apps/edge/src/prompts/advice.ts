// Prompt text lives in @crewstrike/shared so the on-device tier uses the same words.
export { ADVICE_SCHEMA, ADVICE_SYSTEM, RECAP_SCHEMA, RECAP_SYSTEM } from '@crewstrike/shared';

/** Neurons reserved per call (Llama 3.1 8B rates, rounded up). */
export const RESERVE = { advice: 7, recap: 12, sttPerSecond: 1 } as const;
