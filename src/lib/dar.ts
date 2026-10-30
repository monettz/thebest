import { APP_TIMEZONE } from '@shared/constants';

// Building an Intl.DateTimeFormat is expensive (about 60x slower than reusing one), and reports call
// these thousands of times, so every formatter is created once.
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });

/** yyyy-mm-dd in Africa/Dar_es_Salaam. */
export const todayDar = (now: Date = new Date()): string => dateFmt.format(now);

/** HH:MM in Africa/Dar_es_Salaam. */
export const timeDar = (now: Date = new Date()): string => timeFmt.format(now);
