// Entry point for the native simulator build (pio run -e native).
// Firmware builds skip this file: PIXELART_SIM is only set by the native env.

#if defined(PIXELART_SIM) && !defined(PIO_UNIT_TESTING)

#include <sim.h>

#include <vector>

#include "animations.h"

int main(int argc, char **argv)
{
  std::vector<sim::Scene> scenes;
  for (size_t i = 0; i < ANIMATION_COUNT; i++)
  {
    scenes.push_back({ANIMATIONS[i].name, ANIMATIONS[i].play});
  }
  return sim::run(argc, argv, scenes.data(), scenes.size());
}

#endif
