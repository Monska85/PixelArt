# PixelArt

Arduino sketches to animate a 16x16 LEDs matrix using ESP32 C3 Supermini board.

## 3D printed frame

You can find the 3D model files to print a frame for the 16x16 LEDs matrix [here](https://www.printables.com/model/1497091-pixel-art-frame). The frame holds the LEDs matrix and has a back support to increase stability and hold the ESP32 board and connection wires.

## Requirements

You have to install the `Adafruit NeoMatrix` library and all its dependencies using the Arduino Library Manager in Arduino IDE.

## Wiring

- Connect the `5V` and `GND` pins of the ESP32 C3 Supermini to the `DC IN` and `GND` pins of the LED matrix.
- Connect the `GPIO4` pin of the ESP32 C3 Supermini to the `DIN` pin of the LED matrix.

### Power supply improvement

You can improve the power supply avoiding to power the LED matrix through the ESP32 C3 Supermini board USB connector. Instead, you can use a separate 5V power supply and wire it as follows:

- connect the `5V` pin of the power supply to the `DC IN` pin of the LED matrix and to the `5V` pin of the ESP32 C3 Supermini board.
- Connect the `GND` pin of the power supply to the `GND` pin of the LED matrix and to the `GND` pin of the ESP32 C3 Supermini board.
- Connect the `GPIO4` pin of the ESP32 C3 Supermini to the `DIN` pin of the LED matrix.

This solution will provide a more stable power supply to the LED matrix, especially when displaying bright images or animations with many LEDs lit up. This will help to prevent voltage drops and issues when you use the PC USB port to power the ESP32 C3 Supermini board. In other words, you use a proper power supply to power both the ESP32 C3 Supermini board and the LED matrix and PC USB port is used only for programming the ESP32 C3 Supermini board.
