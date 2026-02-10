# Ruddr Time Tracker — Chrome Extension

A Chrome extension for logging time, running timers, and managing time entries in Ruddr without leaving your browser.

## Features

- **Day view** — See today's time entries at a glance, with deduped project/task rows
- **Create, edit & delete** entries directly from the popup
- **Timer** — Start/pause/resume a timer from the entry form or play buttons on existing entries
- **Badge** — Shows elapsed timer time on the extension icon while a timer is running
- **Notifications** — End-of-day reminders if hours are below target, periodic nudges during work hours
- **Email sign-in** — Sign in with your Ruddr email (no API key needed per user)

## Install (Developer Mode)

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `ruddrextention` folder
6. The Ruddr icon should appear in your toolbar — click it to get started

## Getting Started

1. Click the extension icon — you'll see a "Sign In" prompt
2. Click **Sign In** to open the options page
3. Enter your Ruddr email address and click **Sign In**
4. Once signed in, close the options tab and click the extension icon again
5. You'll see today's time entries — use **+ New Entry** to add time or the play button to start a timer

## Usage

### Adding Time
- Click **+ New Entry**, select a project/task/role, enter hours, and save

### Timer
- In the entry form, click the **Timer** button to start a timer instead of entering hours manually
- Use the **play button** next to any existing entry to start a timer on it
- The timer bar at the top of the popup shows elapsed time — pause, resume, or dismiss from there
- While running, the badge on the extension icon shows the elapsed time

### Settings
- Click the gear icon to open settings
- Configure end-of-day reminders and periodic nudge notifications
