// SPDX-License-Identifier: GPL-3.0-or-later

// The part of the updater's Host that is the same on the board and in the simulator: the files, the
// firmware slots and the numbers. The board's and the simulator's hosts add the network and the clock.

#pragma once

#include <pixel_codec.h>
#include <updater.h>

#include "app.h"
#include "firmware.h"
#include "platform.h"
#include "storage.h"
#include "updates.h"

namespace updates
{

class StorageHost : public pixelart_update::Host
{
public:
  bool stored_digest(pixelart_update::Kind kind, const std::string &id, std::string &sha256) override
  {
    const std::string path = kind == pixelart_update::Kind::Animation  ? animation_file(id)
                             : kind == pixelart_update::Kind::Playlist ? playlist_file(id)
                                                                       : schedule_file(id);
    storage::Reader file;
    if (file.open(path) != storage::ReadResult::Ok)
      return false;
    // Unreadable counts as not stored, so the server's file replaces it.
    return storage::sha256_hex(file, sha256);
  }

  bool free_space(size_t &bytes) override
  {
    const size_t total = storage::total_bytes(), used = storage::used_bytes();
    if (total < used)
      return false;
    bytes = total - used;
    return true;
  }

  void discard_download() override { storage::remove(TEMP_FILE); }

  uint32_t random_below(uint32_t bound) override { return bound ? platform::random32() % bound : 0; }

  std::string running_firmware() override { return firmware::running_version(); }
  std::string firmware_board() override { return platform::board_name(); }
  std::string skipped_firmware() override { return firmware::skipped(); }
  void clear_skipped_firmware() override { firmware::clear_skipped(); }
  bool firmware_on_trial() override { return firmware::is_on_trial(); }
  bool firmware_record_ready() override { return firmware::record_ready(); }
  bool firmware_slot_size(size_t &bytes) override { return firmware::slot_size(bytes); }

  pixelart_update::Error activate_firmware(const std::string &version) override
  {
    if (!firmware::end_image() || !firmware::activate(firmware::running_version(), version))
      return pixelart_update::Error::FlashError;
    return pixelart_update::Error::None;
  }

  void discard_firmware() override { firmware::abort_image(); }
  void restart_firmware() override { firmware::restart(); }
  uint8_t firmware_progress() override { return firmware::progress(); }
};

// Validates the downloaded temporary file as an upload does and moves it over the stored file.
// Runs on the loop task. The temporary file is gone afterwards.
pixelart_update::Error install_temp_file(pixelart_update::Kind kind, const std::string &id);

#ifdef PIXELART_SIM
// The simulator's host: it reads a folder instead of a server (update_sim.cpp).
pixelart_update::Host &sim_host();
#endif

} // namespace updates
