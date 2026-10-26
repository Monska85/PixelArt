// SPDX-License-Identifier: GPL-3.0-or-later

// A fixed-size queue between two FreeRTOS tasks: messages of a plain type T,
// copied in and out, in storage that is part of the object, so nothing is
// allocated and a full queue just refuses. Several tasks may send; one receives.
// The network task's inbox is one; later steps add the queue of work the
// network task hands to the loop task, with the same class.

#pragma once

#ifndef PIXELART_SIM

#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

#include <cstdint>
#include <type_traits>

template <typename T, size_t N> class Mailbox
{
  static_assert(std::is_trivially_copyable<T>::value, "messages are copied byte by byte");

public:
  Mailbox() { queue_ = xQueueCreateStatic(N, sizeof(T), storage_, &control_); }

  // False when the queue is full.
  bool send(const T &message, TickType_t wait = 0) { return xQueueSend(queue_, &message, wait) == pdTRUE; }
  // False when nothing arrived within `wait`.
  bool receive(T &message, TickType_t wait) { return xQueueReceive(queue_, &message, wait) == pdTRUE; }

private:
  uint8_t storage_[N * sizeof(T)];
  StaticQueue_t control_;
  QueueHandle_t queue_;
};

#endif
