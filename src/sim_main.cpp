// SPDX-License-Identifier: GPL-3.0-or-later

// Entry point for the native simulator build (pio run -e native).
// Firmware builds skip this file: PIXELART_SIM is only set by the native env.

#if defined(PIXELART_SIM) && !defined(PIO_UNIT_TESTING)

#include <pixelart_engine.h>
#include <sim.h>

#include <cstdio>
#include <cstring>
#include <set>

#include "app.h"

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

// Checks every animation and playlist in the data folder with the same code
// the board uses to load them. Returns the process exit status.
int validate()
{
  int errors = 0, files = 0;
  std::set<std::string> valid_ids;
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
      for (const pixelart::PlaylistItem &item : playlist.items())
        if (!valid_ids.count(item.animation))
          diagnostics.push_back({pixelart::Severity::Warning, "unknown_animation", "",
                                 "\"" + item.animation + "\" is missing or invalid"});
    print(playlist_file(name), loaded, diagnostics, errors);
    files++;
  }
  printf("%d files checked in %s, %d rejected\n", files, sim::data_dir().c_str(), errors);
  return errors ? 1 : 0;
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
