# WeDo 2.0 Remote

A simple one-page web app for controlling a **LEGO Education WeDo 2.0 Smart Hub** and its motors over Bluetooth. It replaces the WeDo 2.0 iOS app, which is no longer supported.

Features:
- Connect to the Smart Hub over Bluetooth
- Turn motors on (forward or back) and off, on port 1 and port 2
- Set the motor speed
- Change the hub light colour
- Show the battery level
- A **Stop all motors** button. Motors also stop automatically if you leave the page or lock the phone.

## Using it on an iPhone or iPad

Apple doesn't let Safari or Chrome on iOS use Bluetooth from a web page, so you need a browser that supports Web Bluetooth:

1. Install **Bluefy – Web BLE Browser** (free) from the App Store.
2. In Bluefy, open the app's web address (see "Hosting" below).
3. Press the green button on the Smart Hub. Its light starts flashing.
4. Tap **Connect to Smart Hub**, choose the hub from the list, and allow Bluetooth.
5. Use **On ▶**, **◀ Back** and **■ Off** to control the motor.

On Android, Windows, macOS or ChromeOS, Chrome or Edge works without any extra app.

## Hosting

Web Bluetooth only works on pages served over **HTTPS**. The easiest option is GitHub Pages:

1. In the GitHub repository, go to **Settings → Pages**.
2. Under **Build and deployment**, set Source to *Deploy from a branch*, choose the branch, and select the `/ (root)` folder.
3. After a minute, the app is live at `https://<your-username>.github.io/<repo-name>/`.

The whole app is the single file `index.html`. It has no dependencies, so you can host it anywhere that serves HTTPS.

## Troubleshooting

- **Connect button does nothing:** read the message under the button. The page needs Bluefy on iPhone, an `https://` address, and to be opened directly. A file preview, GitHub's code view, or an app's built-in viewer won't work.
- **Status stuck on "Loading…":** the viewer is blocking the page's scripts. Open the GitHub Pages address in Bluefy.
- **Hub not in the list:** tap *Show all Bluetooth devices* under the button and look for "LPF2 Smart Hub" or similar. Also press the hub's green button again (it switches off after a while), and make sure no other device or app is connected to it.
- **Motor shows "not detected":** unplug the motor cable and plug it back in. The buttons send commands to that port anyway.
- **Motor won't turn at low speed:** WeDo motors need some power to start moving. The app sets the lowest slider setting to about 30% power.
