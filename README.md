# Robot Remote

Simple web-based controls for two older LEGO® Education kits whose official apps no longer work well:

| Kit | Page | Works on |
| --- | --- | --- |
| **WeDo 2.0** Smart Hub | `wedo.html` | Laptop/desktop (Chrome or Edge), Android (Chrome), iPhone/iPad (Bluefy browser only) |
| **MINDSTORMS® NXT** brick (e.g. set 9797) | `nxt.html` | Laptop/desktop only (Chrome or Edge), by USB cable or Bluetooth |
| **Block coding** for WeDo 2.0 and NXT | `code.html` | WeDo 2.0: same as above. NXT: laptop/desktop only |

The home page (`index.html`) asks which kit you have and opens the right controls.

Not made, endorsed or supported by the LEGO Group. LEGO, MINDSTORMS and WeDo are trademarks of the LEGO Group.

# WeDo 2.0

Features:
- Connect to the Smart Hub over Bluetooth
- Turn motors on (forward or back) and off, on port 1 and port 2
- Set the motor speed
- Change the hub light colour and play beeps on the hub's beeper
- Show whether the hub's green button is pressed, and the battery level
- Show readings from a motion sensor or tilt sensor when one is plugged in (the hub detects them automatically)
- A **Stop all motors** button. Motors also stop automatically if you leave the page or lock the phone.

The motion and tilt sensor support follows Scratch's WeDo 2.0 extension but hasn't been tried on real sensors yet. Reports from anyone who has them are welcome.

## Using WeDo 2.0 on an iPhone or iPad

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

The app is plain files (`index.html`, `wedo.html`, `nxt.html`, `code.html`, `wedo-lib.js`, `nxt-lib.js`, `style.css`) with no build step, so you can host it anywhere that serves HTTPS. The block editor loads [Blockly](https://developers.google.com/blockly) from the jsDelivr CDN, so it needs an internet connection.

## WeDo 2.0 troubleshooting

- **Connect button does nothing:** read the message under the button. The page needs Bluefy on iPhone, an `https://` address, and to be opened directly. A file preview, GitHub's code view, or an app's built-in viewer won't work.
- **Status stuck on "Loading…":** the viewer is blocking the page's scripts. Open the GitHub Pages address in Bluefy.
- **Hub not in the list:** tap *Show all Bluetooth devices* under the button and look for "LPF2 Smart Hub" or similar. Also press the hub's green button again (it switches off after a while), and make sure no other device or app is connected to it.
- **Motor shows "not detected":** unplug the motor cable and plug it back in. The buttons send commands to that port anyway.
- **Motor won't turn at low speed:** WeDo motors need some power to start moving. The app sets the lowest slider setting to about 30% power.

# MINDSTORMS NXT

Features:
- Motors A, B and C forward, back and off with a speed slider, and how many degrees each has turned (with a reset)
- Live sensor readings on ports 1–4: touch (pressed/released), light (0–100%, lamp on or off), sound (0–100%) and ultrasonic distance (cm)
- Three beeps, brick name and battery voltage, and **Stop all motors**

The brick can't detect which sensor is on which port, so choose it in the Sensors panel. The default is the standard set 9797 layout: touch on 1, sound on 2, light on 3, ultrasonic on 4. Your choice is remembered in the browser.

Phones and tablets can't be used: the NXT uses an older type of Bluetooth that iOS and Android browsers can't reach. Use Chrome or Edge on a laptop or desktop.

1. Turn the brick on with the orange button.
2. Open the app, choose **MINDSTORMS NXT**, then connect by USB or Bluetooth.

**USB (recommended):** plug in the brick's USB cable and click **Connect by USB**.
- **Windows:** if connecting fails, Windows is using LEGO's own NXT driver, which browsers can't use. Run the free tool [Zadig](https://zadig.akeo.ie/), choose the "NXT" device and install the **WinUSB** driver. The old LEGO NXT-G software can't see the brick again until you switch the driver back.
- **Mac and Chromebook:** should work without extra steps.

**Bluetooth:**
1. On the brick, go to Bluetooth → On/Off → On, and Bluetooth → Visibility → Visible.
2. Pair the brick in the computer's Bluetooth settings. The passkey is usually 1234; confirm it on the brick with the orange button.
3. Click **Connect by Bluetooth** and choose the brick (or its COM port on Windows).

The brick goes to sleep after a while with no activity. While connected, the app keeps it awake.

## NXT Bluetooth troubleshooting

- **"Failed to open serial port":** the computer couldn't reach the brick. Check the brick is on and awake, and that no other tab or program (such as the LEGO software) is connected to it. Then turn the brick's Bluetooth off and on (or restart the brick) and try again.
- **"No reply from brick":** the port opened but the brick didn't answer. On Windows you may have picked the wrong port: Windows creates two for the brick. Open Settings → Bluetooth & devices → More Bluetooth settings → COM Ports and use the one marked **Outgoing**.
- **Worked once, now keeps failing:** the NXT's Bluetooth can get stuck after a connection ends. Restart the brick. If that doesn't help, remove the brick in the computer's Bluetooth settings and pair it again.
- USB is more reliable than Bluetooth if you have the cable.

# Block coding

`code.html` is a Scratch-style block editor, built with Blockly, for both kits. Use the **WeDo 2.0 / NXT** switch at the top to choose the kit; each kit has its own blocks, examples and saved program.

1. Drag blocks under **when ▶ Run is clicked**. Blocks that aren't attached under a Run block don't run; several Run blocks run at the same time.
2. Connect (the hub, or the NXT brick by USB or Bluetooth) and press **▶ Run**. The block that is running lights up, and **■ Stop** ends the program at any time and stops the motors.
3. Sensor values the program reads appear under **Readings**, and **show** blocks print to **Output**.

Programs are saved in the browser automatically. **Save** downloads a `.json` file and **Open** loads one, for keeping or sharing programs (on phones these are under the **File** menu). The program stops if the page is hidden, for example when the phone is locked.

The editor works on phones and tablets for WeDo 2.0 (in Bluefy on iPhone and iPad). It loads Blockly from the internet, so it needs a connection.

**Blocks for both kits:** wait, wait until, forever, repeat, repeat while/until, if / if-else; comparisons, and/or/not, maths, random numbers, text; variables; timer; show.

**WeDo 2.0 blocks:** motor 1, 2 or both on / for seconds / stop; hub light colour; hub beeper; hub button pressed and wait for the button; motion sensor distance; tilted and tilt angle. Sensor blocks find the sensor on whichever port it's plugged into, and say so if none is plugged in.
Examples: spin, light and beep; back and forth; traffic light; button turns motor on and off; speed up (variables); motion alarm (needs a motion sensor).

**NXT blocks:** motors on / for seconds, rotations or degrees / stop, motor rotation; touch, light (lamp on or off), sound and ultrasonic distance on any port; tones. Each sensor block sets its port to the right sensor type the first time it's used, so the NXT page's sensor setup isn't needed.
Examples: drive until close to a wall, bump and turn, line follower, clap to start, count touches.

The program runs in the browser and sends commands as it goes, so the hub or brick must stay connected. Over NXT USB it reacts almost instantly; over Bluetooth each reading or command takes a few hundredths of a second.
