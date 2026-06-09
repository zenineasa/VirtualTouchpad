# Virtual touchpad

A simple web-based touchpad and remote control for your computer.

I instructed an AI to develop this project to solve a simple problem: controlling my laptop from bed while it was connected to an old TV via HDMI. Existing solutions were often outdated, cumbersome or no longer worked with modern Python environments. By iteratively prompting in Antigravity, this project evolved into a lightweight browser-based virtual touchpad plus navigation keys combination that can be used from a smartphone or tablet on the same network.

## Features
- Touchpad-style mouse control
- Smooth touch gestures
- Directional navigation buttons (Arrow keys)
- Space bar button for play/pause and media control
- Works from any modern mobile browser
- No mobile app installation required
- Lightweight and easy to run

## Use Case

Imagine this setup:

1. Connect your laptop to a TV using HDMI.
2. Start VirtualTouchpad on the laptop.
3. Open the provided URL on your phone.
4. Put the laptop aside.
5. Control playback and basic navigation directly from your bed.

This is particularly useful for:

- Watching YouTube
- Streaming movies
- Browsing media libraries
- Presentations
- Using a computer connected to a TV from across the room

## How It Works

VirtualTouchpad runs a small web server on your computer.

When you open the web interface from your phone or tablet, touch events are sent to the computer and translated into mouse and keyboard actions.

## Installation

```bash
git clone https://github.com/zenineasa/VirtualTouchpad.git
cd VirtualTouchpad
pip install -r requirements.txt
```

## Running

```bash
python main.py
```

The application will display a local URL and a pin. Open that URL from a phone or tablet connected to the same network.

## Requirements

- Python 3.14.x
- Computer and mobile device on the same network
- Modern web browser

## Design Goals

This project prioritizes:
- Simplicity over feature bloat
- Low latency
- Easy deployment
- Browser-only client access
- Compatibility with modern Python environments

It is intentionally focused on the common "laptop connected to TV" scenario rather than trying to replace full-featured remote desktop software.

## Limitations

- Devices must generally be on the same network.
- Designed primarily for basic media and navigation control.
- Not intended as a complete remote desktop solution.

## Why Another Touchpad Project?

Many older browser-based touchpad projects were created years ago and no longer work reliably on modern Python versions or operating systems. This project was created as a practical replacement for a very specific problem:

"I want to control my laptop from bed while it's connected to a TV."

If that sounds familiar, VirtualTouchpad may be exactly what you need.

## Contributing

Issues, suggestions and pull requests are welcome.

If you find a bug or have an idea for improving the touchpad experience, feel free to open an issue.
