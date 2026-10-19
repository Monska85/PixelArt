// Engine for pixelart/1 animation files: parsing, validation and playback.
// The format is specified in docs/format/pixelart-v1.md. The engine has no
// Arduino dependency, so the firmware, the simulator and the tests share it.

#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace pixelart
{

constexpr int CANVAS_WIDTH = 16;
constexpr int CANVAS_HEIGHT = 16;

// Limits from docs/format/pixelart-v1.md#limits
constexpr size_t MAX_FILE_SIZE = 64 * 1024;
constexpr size_t MAX_PALETTE = 256;
constexpr size_t MAX_COLORS = 256;
constexpr size_t MAX_SPRITES = 64;
constexpr size_t MAX_POINTS = 4096;
// Pixels drawn in one frame, counting every part of composite sprites. Keeps the
// render time of a frame bounded whatever the nesting of composites.
constexpr size_t MAX_DRAWN_POINTS = 4096;
// Diagnostics kept per load, so an invalid file cannot exhaust memory.
constexpr size_t MAX_DIAGNOSTICS = 32;
constexpr int MAX_COMPOSITE_DEPTH = 4;
constexpr int MAX_LOOP_DEPTH = 4;
constexpr size_t MAX_TIMELINE_ITEMS = 1024;
constexpr size_t MAX_SHOW = 32;
constexpr size_t MAX_PARTS = 64;
constexpr int MAX_COUNT = 10000;
constexpr int MIN_MS = 20;
constexpr int MAX_MS = 60000;
constexpr int MIN_COORD = -128;
constexpr int MAX_COORD = 127;
constexpr int DEFAULT_FRAME_MS = 500;
constexpr int MIN_BRIGHTNESS_PERCENT = 1;
constexpr int MAX_BRIGHTNESS_PERCENT = 100;
constexpr int DEFAULT_BRIGHTNESS_PERCENT = 100;

// Brightness the LEDs receive for a board brightness (0 to 255) and an
// animation's percentage (1 to 100). Rule of docs/format/pixelart-v1.md#brightness:
// an animation never switches the matrix off, only a board brightness of 0 does.
constexpr uint8_t effective_brightness(uint8_t board, uint8_t percent)
{
  if (board == 0)
    return 0;
  const unsigned value = (board * (unsigned)percent + 50) / 100;
  return value == 0 ? 1 : (uint8_t)value;
}

enum class Severity
{
  Error,
  Warning
};

// One validation finding. `code` is one of the error or warning codes of the
// specification, `where` points at the place in the file (for example
// "sprites.tree.points[3]").
struct Diagnostic
{
  Severity severity;
  std::string code;
  std::string where;
  std::string message;
};

// Color as 0xRRGGBB. 0 means off.
using Rgb = uint32_t;

// One rendered frame: the color of every pixel and how long it is shown.
struct Frame
{
  Rgb pixels[CANVAS_HEIGHT][CANVAS_WIDTH];
  uint16_t ms;
};

class Animation
{
public:
  // Parses and validates a pixelart/1 JSON document. Returns false if there is
  // any error; diagnostics then holds every error and warning found. A failed
  // load leaves the animation empty.
  bool load(const char *json, size_t length, std::vector<Diagnostic> &diagnostics);

  bool loaded() const { return loaded_; }
  const std::string &name() const { return name_; }
  uint32_t version() const { return version_; }
  // Percentage of the board brightness, 1 to 100.
  uint8_t brightness() const { return brightness_; }

private:
  friend class Player;
  friend class Loader;

  struct Pos
  {
    int8_t x = 0, y = 0;
  };

  struct Point
  {
    int8_t x, y;
    uint8_t color;
  };

  struct Part
  {
    uint8_t sprite;
    bool has_at;
    Pos at;
  };

  struct Sprite
  {
    std::string name;
    Pos at;
    bool has_pivot = false;
    Pos pivot;
    std::vector<Point> points;
    std::vector<Part> parts;
    int16_t min_x = 0, min_y = 0, max_x = 0, max_y = 0; // bounding box, sprite coordinates
    uint32_t drawn_points = 0;                          // pixels drawn, counting every part of composites
  };

  struct Ref
  {
    uint8_t sprite = 0;
    bool has_at = false;
    Pos at;
    Pos move;
    bool wrap = false;
    int16_t rotate = 0, spin = 0;
    uint8_t flip = 0; // FLIP_X | FLIP_Y
    bool has_pivot = false;
    Pos pivot;
  };

  struct Recolor
  {
    uint8_t from, to;
  };

  // A timeline item. For a frame, [first, first + size) indexes refs_ and
  // count is `repeat`. For a loop, it indexes children_ and count is `loop`.
  struct Item
  {
    bool is_loop = false;
    uint16_t count = 1;
    uint16_t ms = DEFAULT_FRAME_MS;
    uint32_t first = 0, size = 0;
    uint32_t recolor_first = 0, recolor_size = 0;
  };

  static constexpr uint8_t FLIP_X = 1, FLIP_Y = 2;

  // Position of a part inside its composite: its own `at` in the composite,
  // else the part sprite's home position.
  Pos part_position(const Part &part) const { return part.has_at ? part.at : sprites_[part.sprite].at; }

  void clear();

  bool loaded_ = false;
  std::string name_;
  uint32_t version_ = 1;
  uint8_t brightness_ = DEFAULT_BRIGHTNESS_PERCENT;
  bool has_background_ = false;
  uint8_t background_ = 0;
  std::vector<Rgb> colors_; // distinct colors, indexed by Point::color
  std::vector<Sprite> sprites_;
  std::vector<Ref> refs_;
  std::vector<Recolor> recolors_;
  std::vector<Item> items_;
  std::vector<uint32_t> children_; // item indexes, grouped by parent
  uint32_t root_first_ = 0, root_size_ = 0;
};

// One enabled entry of a playlist.
struct PlaylistItem
{
  std::string animation; // animation ID: its file name without extension
  uint16_t repeat;
};

constexpr size_t MAX_PLAYLIST_FILE_SIZE = 16 * 1024;
constexpr size_t MAX_PLAYLIST_ITEMS = 256;
constexpr int MAX_PLAYLIST_REPEAT = 1000;

// A pixelart-playlist/1 document (docs/format/playlist-v1.md).
class Playlist
{
public:
  // Parses and validates a playlist. Returns false on any error. Disabled
  // items are dropped, so items() lists exactly what to play, in order.
  bool load(const char *json, size_t length, std::vector<Diagnostic> &diagnostics);

  const std::vector<PlaylistItem> &items() const { return items_; }

private:
  std::vector<PlaylistItem> items_;
};

// True if `id` is a valid animation or playlist ID (file name without extension).
bool is_valid_id(const char *id);

// Plays an animation frame by frame. The animation must outlive the player.
class Player
{
public:
  explicit Player(const Animation &animation);

  // Starts again from the first frame.
  void restart();

  // Renders the next frame. Returns false when the timeline is over.
  bool next(Frame &frame);

private:
  struct Level
  {
    uint32_t first, size, pos;
    uint16_t done, total;
  };

  struct Transform;
  void render(const Animation::Item &item, uint32_t k, Frame &frame) const;

  // Calls plot(x, y, color) for every point of a sprite, in the sprite's own
  // coordinates. Parts of a composite are shifted by their position in it.
  // Depth is bounded by MAX_COMPOSITE_DEPTH, checked at load.
  template <typename Plot> static void walk(const Animation &a, const Animation::Sprite &s, int dx, int dy, Plot &&plot)
  {
    for (const Animation::Point &p : s.points)
      plot(p.x + dx, p.y + dy, p.color);
    for (const Animation::Part &part : s.parts)
    {
      const Animation::Pos at = a.part_position(part);
      walk(a, a.sprites_[part.sprite], dx + at.x, dy + at.y, plot);
    }
  }

  const Animation &animation_;
  std::vector<Level> stack_;
  const Animation::Item *frame_ = nullptr;
  uint32_t repetition_ = 0;
};

} // namespace pixelart
