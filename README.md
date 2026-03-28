#  Arcane Waver: Elemental Battle AR

**Arcane Waver** is an immersive, browser-based AR magic battle game. It uses **MediaPipe Hands** to track your physical hand movements, allowing you to cast elemental spells through gestures and shapes in mid-air.

Fight off waves of enemies (Slimes) in **Wave Defense** or hone your skills in the **Practice Tool**.

---

##  Quick Start

### 1. Prerequisites
- **Node.js** (v16+)
- **Webcam** (for hand tracking)

### 2. Installation
```bash
# Clone or download the repository
cd arcane-waver

# Install dependencies
npm install
```

### 3. Configuration
Copy the template `.env.example` to a new file named `.env` and add your Gemini API Key if you want to enable experimental AI features.
```bash
cp .env.example .env
```

### 4. Launch
```bash
npm start
```
Then open [http://localhost:3000](http://localhost:3000) in your browser.

---

##  How to Play

### Gesture Controls (Use your Right Hand)
1. **Move Your Character**: Hover your hand over the **Tactical Mirror** (the webcam feed). Your character follows your hand's relative position on the screen.
2. **Draw a Spell (Open Index Finger)**: Point at the screen to start drawing a magical trail.
3. **Cast (Fist)**: Close your hand into a fist to "submit" the shape and cast the spell.
4. **Master Spells (Hold Fist)**: Combine spells or repeat shapes to charge up powerful "Master" versions of elements.

### Game Modes
- **Wave Defense**: Survive increasingly difficult waves of Slimes. Track your **Score** and the **Wave Number** in the HUD.
- **Practice Tool**: A safe environment with immortal Training Dummies to test spell combos and damage numbers.

###  Elements & Status Effects
- **Fire**: Deals high damage and applies **Burn** (DoT).
- **Water**: Applies **Slow**, reducing enemy speed significantly.
- **Earth**: High impact damage and applies **Stun**.
- **Wind**: Massive **Knockback** to push enemies away.

---

## Tech Stack
- **Frontend**: HTML5 Canvas, Vanilla CSS3 (Retro-Style), JavaScript (ESM).
- **Vision**: [MediaPipe Hands](https://google.github.io/mediapipe/solutions/hands.html) for real-time skeletal hand tracking.
- **Backend**: **Node.js** + **Express** for static serving.
- **Real-time**: **WebSockets (`ws`)** for state synchronization between client and server.
- **Design**: Retro-pixel aesthetics with modern glowing FX and lerp-based smoothing.

---

## Credits 
Developed as a project for **SWM x Gemini**.
