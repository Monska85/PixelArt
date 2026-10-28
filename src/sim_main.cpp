// SPDX-License-Identifier: GPL-3.0-or-later

// Entry point for the native simulator build (pio run -e native).
// Firmware builds skip this file: PIXELART_SIM is only set by the native env.

#if defined(PIXELART_SIM) && !defined(PIO_UNIT_TESTING)

#include <pixelart_engine.h>
#include <sim.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <set>
#include <string>

#include "app.h"
#include "firmware.h"
#include "settings.h"
#include "updates.h"

namespace
{

// Prints the diagnostics of one file. A rejected file counts as one error
// whatever was printed, so the exit status never depends on which messages
// survived the cap.
void print(const std::string &file, bool loaded, const std::vector<pixelart::Diagnostic> &diagnostics, int &errors)
{
  errors += loaded ? 0 : 1;
  for (const pixelart::Diagnostic &d : diagnostics)
  {
    bool is_error = d.severity == pixelart::Severity::Error;
    printf("%s: %s %s%s%s: %s\n", file.c_str(), is_error ? "error" : "warning", d.code.c_str(),
           d.where.empty() ? "" : " at ", d.where.c_str(), d.message.c_str());
  }
}

// Checks every animation, playlist, schedule and play file in the data folder with the same code
// the board uses to load them. Returns the process exit status.
int validate()
{
  int errors = 0, files = 0;
  std::set<std::string> valid_ids, valid_playlists, valid_schedules;
  for (const std::string &id : stored_animations())
  {
    pixelart::Animation animation;
    std::vector<pixelart::Diagnostic> diagnostics;
    bool loaded = load_stored_animation(id, animation, diagnostics);
    if (loaded)
      valid_ids.insert(id);
    print(animation_file(id), loaded, diagnostics, errors);
    files++;
  }
  for (const std::string &name : stored_playlists())
  {
    pixelart::Playlist playlist;
    std::vector<pixelart::Diagnostic> diagnostics;
    bool loaded = load_stored_playlist(name, playlist, diagnostics);
    if (loaded)
      valid_playlists.insert(name);
    if (loaded)
      for (const pixelart::PlaylistItem &item : playlist.items())
        if (!valid_ids.count(item.animation) && diagnostics.size() < pixelart::MAX_DIAGNOSTICS)
          diagnostics.push_back({pixelart::Severity::Warning, "unknown_animation", "",
                                 "\"" + item.animation + "\" is missing or invalid"});
    print(playlist_file(name), loaded, diagnostics, errors);
    files++;
  }
  for (const std::string &id : stored_schedules())
  {
    pixelart::Schedule schedule;
    std::vector<pixelart::Diagnostic> diagnostics;
    bool loaded = load_stored_schedule(id, schedule, diagnostics);
    if (loaded)
      valid_schedules.insert(id);
    auto warn = [&](const std::vector<std::string> &ids, const std::string &where)
    {
      for (size_t i = 0; i < ids.size(); i++)
        if (!valid_playlists.count(ids[i]) && diagnostics.size() < pixelart::MAX_DIAGNOSTICS)
          diagnostics.push_back({pixelart::Severity::Warning, "unknown_playlist", where + "[" + std::to_string(i) + "]",
                                 "\"" + ids[i] + "\" is missing or invalid"});
    };
    if (loaded)
    {
      warn(schedule.fallback(), "fallback");
      for (size_t e = 0; e < schedule.entry_count(); e++)
        warn(schedule.playlists(e), "entries[" + std::to_string(e) + "].playlists");
    }
    print(schedule_file(id), loaded, diagnostics, errors);
    files++;
  }
  for (const std::string &id : stored_play_files())
  {
    pixelart::ServerChoice choice;
    std::vector<pixelart::Diagnostic> diagnostics;
    const bool loaded = load_stored_play(id, choice, diagnostics);
    if (loaded && !choice.schedule.empty() && !valid_schedules.count(choice.schedule))
      diagnostics.push_back({pixelart::Severity::Warning, "unknown_schedule", "default.schedule",
                             "\"" + choice.schedule + "\" is missing or invalid"});
    for (size_t i = 0; loaded && i < choice.playlists.size(); i++)
      if (!valid_playlists.count(choice.playlists[i]))
        diagnostics.push_back({pixelart::Severity::Warning, "unknown_playlist",
                               "default.playlists[" + std::to_string(i) + "]",
                               "\"" + choice.playlists[i] + "\" is missing or invalid"});
    print(play_file(id), loaded, diagnostics, errors);
    files++;
  }
  printf("%d files checked in %s, %d rejected\n", files, sim::data_dir().c_str(), errors);
  return errors ? 1 : 0;
}

[[noreturn]] void option_error(const std::string &message)
{
  fprintf(stderr, "sim: %s\n", message.c_str());
  exit(2);
}

// --update-fail KIND[:PATH]: makes the simulated server fail, for testing the update errors.
void inject_update_failure(const std::string &spec)
{
  const size_t colon = spec.find(':');
  const std::string kind = spec.substr(0, colon);
  const std::string path = colon == std::string::npos ? "" : spec.substr(colon + 1);
  updates::Failure failure;
  if (updates::sim_failure_from_name(kind, failure))
  {
    updates::sim_inject(failure, path);
    return;
  }
  option_error("--update-fail expects down, tls, http, cut, corrupt or too_long, then :PATH for a file, got '" + spec +
               "'");
}

// --update-time HH:MM: the local time the install window sees. Without it the time is not known.
void set_update_time(const std::string &text)
{
  unsigned hours, minutes;
  char extra;
  if (sscanf(text.c_str(), "%u:%u%c", &hours, &minutes, &extra) != 2 || hours > 23 || minutes > 59)
    option_error("--update-time expects HH:MM, got '" + text + "'");
  updates::sim_set_local_minutes((int)(hours * 60 + minutes));
}

// --date YYYY-MM-DD: the local date the schedule sees. Without it, and without --update-time, the time is not known.
void set_local_date(const std::string &text)
{
  unsigned year = 0, month = 0, day = 0;
  char extra;
  const bool parsed = sscanf(text.c_str(), "%4u-%2u-%2u%c", &year, &month, &day, &extra) == 3 && text.size() == 10;
  const pixelart::LocalDate date = {(uint16_t)year, (uint8_t)month, (uint8_t)day};
  if (!parsed || !pixelart::is_schedule_date(date))
    option_error("--date expects a real date YYYY-MM-DD with a year from 2000 to 2999, got '" + text + "'");
  updates::sim_set_local_date(date);
}

// --update-trial ok|fail: whether the health check of a firmware just installed passes. A failed one makes the
// simulated board roll back to the firmware it came from.
void set_update_trial(const std::string &text)
{
  if (text == "fail")
    firmware::sim_fail_next_health();
  else if (text != "ok")
    option_error("--update-trial expects ok or fail, got '" + text + "'");
}

} // namespace

int main(int argc, char **argv)
{
  bool validate_only = false;
  for (int i = 1; i < argc; i++)
  {
    if (!strcmp(argv[i], "--data") && i + 1 < argc)
      sim::set_data_dir(argv[i + 1]);
    validate_only = validate_only || !strcmp(argv[i], "--validate");
  }
  if (validate_only)
    return validate();
  sim::register_option("--token",
                       "token of the simulated board, 16 characters from a-z and 0-9 (default: a new one each run)",
                       [](const char *token)
                       {
                         if (!settings::valid_token(token))
                           option_error("--token expects 16 characters from a-z and 0-9");
                         settings::sim_set_start_token(token);
                       });
  sim::register_option("--update-source",
                       "folder that stands in for the servers of the updates: the path of a URL is looked up in it",
                       [](const char *folder)
                       {
                         updates::sim_use_folder(folder);
                       });
  sim::register_option("--update-fail",
                       "make the simulated server fail: down, or tls, http, cut, corrupt, too_long[:PATH] (repeatable)",
                       [](const char *spec)
                       {
                         inject_update_failure(spec);
                       });
  sim::register_option("--update-time", "local time for the install window, HH:MM (default: not known)",
                       [](const char *text)
                       {
                         set_update_time(text);
                       });
  sim::register_option("--date", "local date for the schedule, YYYY-MM-DD (default: not known)",
                       [](const char *text)
                       {
                         set_local_date(text);
                       });
  sim::register_option("--firmware-version",
                       "version of the simulated firmware, for the update checks (default: the build's version)",
                       [](const char *version)
                       {
                         firmware::sim_set_version(version);
                       });
  sim::register_option("--update-trial", "ok (default) or fail: the health check of a firmware just installed",
                       [](const char *text)
                       {
                         set_update_trial(text);
                       });
  // An installed firmware restarts the simulated board, which starts its sketch again.
  firmware::sim_set_restart_hook(
      []
      {
        firmware::sim_clear_restart();
        sim::restart();
      });
  return sim::run(argc, argv,
                  []
                  {
                    std::vector<sim::Scene> scenes;
                    for (const std::string &id : stored_animations())
                      scenes.push_back({id, [id]
                                        {
                                          play_stored_animation(id);
                                        }});
                    return scenes;
                  });
}

#endif
