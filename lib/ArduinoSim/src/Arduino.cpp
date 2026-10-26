// SPDX-License-Identifier: GPL-3.0-or-later

#include "Arduino.h"

#include "sim.h"

HardwareSerial Serial;

void delay(unsigned long ms) { sim::advance_us((uint64_t)ms * 1000); }
void delayMicroseconds(unsigned int us) { sim::advance_us(us); }
void yield() {}

int HardwareSerial::available() { return (int)sim::serial_input_size(); }
int HardwareSerial::read() { return sim::serial_input_read(); }

size_t HardwareSerial::write(uint8_t c)
{
  sim::on_serial((char)c);
  return 1;
}
