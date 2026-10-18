/** "October 24, 2026, 5:30 PM IST". Deadlines are shown in IST, where most candidates are. */
export const formatInterviewDeadline = (iso: string) =>
  `${new Date(iso).toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} IST`;
