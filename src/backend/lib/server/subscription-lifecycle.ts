const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export function calculateTrialEndDate(start: Date, trialDays: number): Date {
  if (!Number.isInteger(trialDays) || trialDays < 1) {
    throw new RangeError("Trial duration must be a positive whole number of days.");
  }
  return new Date(start.getTime() + trialDays * DAY_IN_MILLISECONDS);
}

export function addBillingMonth(date: Date): Date {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}
