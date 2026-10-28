// SPDX-License-Identifier: GPL-3.0-or-later

export { loadAnimation } from "./animation";
export { loadPlaylist } from "./playlist";
export {
  NEXT_CHANGE_DAYS,
  PLAY_REASONS,
  choosePlaylists,
  isScheduleDate,
  loadSchedule,
  nextDay,
  nextScheduleChange,
  scheduleWinner,
} from "./schedule";
export type {
  LocalDate,
  PlayChoice,
  PlayMode,
  PlayReason,
  Schedule,
  ScheduleEnd,
  ScheduleEntry,
  ScheduleResult,
} from "./schedule";
export { Player } from "./player";
export {
  parseStrictJson,
  ANIMATION_JSON_DEPTH,
  PLAYLIST_JSON_DEPTH,
  SCHEDULE_JSON_DEPTH,
  JsonNumber,
  isArray,
  isObject,
} from "./json";
export type { JsonArray, JsonObject, JsonValue } from "./json";
export * from "./types";
