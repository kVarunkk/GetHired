import "server-only";
import { googleCalendar } from "./google";
import type { CalendarProvider } from "./provider";

/** The provider the app uses (Google in v1, D3). Tests mock this module with FakeCalendarProvider. */
export function calendarProvider(): CalendarProvider {
  return googleCalendar;
}
