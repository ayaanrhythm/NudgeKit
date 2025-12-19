# Sleep Regularity Nudge Kit – Run Guide

A small React Native / Expo app that demos a sleep-regularity nudge based on recent midsleep times.

1. Prerequisites

Node.js (recent LTS is fine)

npm (comes with Node)

Expo CLI (you can use npx expo so no global install is required)

2. Install

From the project root:

# Install dependencies
npm install


This reads package.json and installs all required Expo and React Native packages.

3. Run the app

From the project root:

# start Expo
npm start
# or
npx expo start


Expo will open a browser window with the Metro bundler.

There are two easy options:

Run in a web browser

In the Expo page, click “Run in web browser” or press w in the terminal.

This is the simplest way to inspect the UI, sleep logic and mood tracking.

Note: browser notification and audio behavior is limited; the app shows an in-app nudge card so the demo still works.

Run on a phone (optional)

Install the Expo Go app on an iOS or Android device.

Scan the QR code shown in the Metro bundler.

Notifications and background audio work more realistically on device.

4. Quick demo script

Once the app is running:

On the main screen, tap:

“Seed demo nights” to create 7 synthetic sleep nights.

Optionally “Add on-time night” or “Add late night” to see how risk changes.

Look at the card that shows:

Coverage, baseline midsleep, recent lateness, regularity loss, and tonight’s risk label.

Press “Show nudge now (with why)”

An in-app card appears with the exact nudge text we would send.

Press “Schedule bedtime nudge (+60s demo)”

On device: a real notification fires about 60 seconds later.

On web: a preview text is shown.

Tap “Check in” in the bottom right to:

Log a few mood check-ins.

Switch to the summary view to see weekly and monthly mood frequencies.
