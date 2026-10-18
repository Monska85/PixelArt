#include "Arduino.h"

#include <random>

#include "sim.h"

HardwareSerial Serial;

static std::mt19937 &rng()
{
  static std::mt19937 gen(sim::seed());
  return gen;
}

// Each clock read advances time by 1us so busy-wait loops on millis() end.
unsigned long millis()
{
  sim::advance_us(1);
  return (unsigned long)(sim::now_us() / 1000);
}

unsigned long micros()
{
  sim::advance_us(1);
  return (unsigned long)sim::now_us();
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

long map(long x, long in_min, long in_max, long out_min, long out_max)
{
  if (in_max == in_min)
    return out_min;
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

void pinMode(uint8_t, uint8_t) {}
void digitalWrite(uint8_t, uint8_t) {}
int digitalRead(uint8_t) { return LOW; }
int analogRead(uint8_t) { return 0; }
void analogWrite(uint8_t, int) {}

size_t HardwareSerial::write(uint8_t c)
{
  sim::on_serial((char)c);
  return 1;
}
