#include "Arduino.h"

#include <random>

#include "sim.h"

HardwareSerial Serial;

static std::mt19937 &rng()
{
  static std::mt19937 gen(sim::seed());
  return gen;
}

void delay(unsigned long ms) { sim::advance_us((uint64_t)ms * 1000); }
void delayMicroseconds(unsigned int us) { sim::advance_us(us); }
void yield() {}

long random(long max)
{
  if (max <= 0)
    return 0;
  return (long)(rng()() % (unsigned long)max);
}

long random(long min, long max)
{
  if (min >= max)
    return min;
  return min + random(max - min);
}

void randomSeed(unsigned long seed)
{
  if (seed != 0)
    rng().seed(seed);
}

int HardwareSerial::available() { return (int)sim::serial_input_size(); }
int HardwareSerial::read() { return sim::serial_input_read(); }

size_t HardwareSerial::write(uint8_t c)
{
  sim::on_serial((char)c);
  return 1;
}
