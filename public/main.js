import { VisionSubsystem } from './vision.js';
import { GameNetwork } from './network.js';

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const debugElement = document.getElementById('debug-log');
    function logDebug(msg) {
        if (debugElement) {
            debugElement.innerText += `[LOG] ${msg}\n`;
            console.warn(msg);
        }
    }
    window.onerror = (msg, url, line) => {
        logDebug(`Error: ${msg} @ ${line}`);
        return false;
    };

    const videoElement = document.getElementById('webcam');
    const visionCanvas = document.getElementById('vision-canvas');
    const currentElementSpan = document.getElementById('current-element');
    const activeRune = document.getElementById('active-rune');
    const runeContainer = document.getElementById('rune-container');
    const masterSpellAlert = document.getElementById('master-spell-alert');
    const battlefieldEle = document.getElementById('battlefield');
    const statusDot = document.createElement('div');
    statusDot.id = 'status-dot';
    statusDot.style.position = 'fixed';
    statusDot.style.top = '10px';
    statusDot.style.right = '10px';
    statusDot.style.padding = '8px 12px';
    statusDot.style.backgroundColor = '#f00';
    statusDot.style.color = '#fff';
    statusDot.style.fontFamily = '"Press Start 2P"';
    statusDot.style.fontSize = '8px';
    statusDot.style.zIndex = '1000';
    statusDot.innerText = 'OFFLINE';
    document.body.appendChild(statusDot);

    // State
    const playersInfo = {};
    const projectilesInfo = {};
    const botsInfo = {}; // NEW: Bot state
    const particles = []; // For spell trails
    let myId = null;
    let myX = 1500;
    let myY = 1500;
    let myDirX = 1;
    let myDirY = 0;
    const speed = 7;

    // Controls
    const keys = { w: false, a: false, s: false, d: false };
    
    // UI Toggles
    const settingsMenu = document.getElementById('settings-menu');
    const toggleMirrorBtn = document.getElementById('toggle-mirror');
    const tacticalMirror = document.querySelector('.tactical-mirror');
    const toggleDevtoolsBtn = document.getElementById('toggle-devtools');
    const devtoolsPanel = document.getElementById('devtools-panel');
    
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            settingsMenu.classList.toggle('hidden');
        } else {
            const key = e.key.toLowerCase();
            if (keys.hasOwnProperty(key)) keys[key] = true;
        }
    });
    
    toggleMirrorBtn.addEventListener('change', (e) => {
        tacticalMirror.style.display = e.target.checked ? 'block' : 'none';
    });

    if (toggleDevtoolsBtn && devtoolsPanel) {
        toggleDevtoolsBtn.addEventListener('change', (e) => {
            devtoolsPanel.style.display = e.target.checked ? 'block' : 'none';
        });
    }

    // Score & Wave Tracking
    let score = 0;
    let currentWave = 1;
    const scoreEl = document.getElementById('score-value');
    const waveEl = document.getElementById('wave-value');
    function updateScoreUI() { if (scoreEl) scoreEl.innerText = score; }
    function updateWaveUI(w) { if (waveEl) waveEl.innerText = w; currentWave = w; }



    window.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (keys.hasOwnProperty(key)) keys[key] = false;
    });

    // Initialize Network and Vision Logic (MediaPipe Hands)
    const network = new GameNetwork(
        (data) => {
            if (data.type === 'sync') {
                console.log("SYNC PACKET RECEIVED:", data);
                myId = data.id;
                statusDot.innerText = 'CONNECTED';
                statusDot.style.backgroundColor = '#0f0';
                Object.assign(playersInfo, data.players);
                if (data.training_bots) {
                    Object.assign(botsInfo, data.training_bots);
                    logDebug(`Synced ${Object.keys(data.training_bots).length} training dummies.`);
                }
                network.sendMove(myX, myY, myDirX, myDirY);
                // DIAGNOSTIC - UPDATE UI
                const botCounter = document.getElementById('bot-counter');
                if (botCounter) botCounter.innerText = `BOTS IN MEMORY: ${Object.keys(botsInfo).length}`;
            } else if (data.type === 'sync_bots') {
                if (data.training_bots) {
                    // For waves mode, merge carefully: don't restore removed slimes
                    for (const id in data.training_bots) {
                        botsInfo[id] = data.training_bots[id];
                    }
                    // Update wave counter if server sends wave info
                    if (data.waveNumber) updateWaveUI(data.waveNumber);
                }
            } else if (data.type === 'player_joined') {
                playersInfo[data.id] = data.state;
            } else if (data.type === 'player_left') {
                delete playersInfo[data.id];
            } else if (data.type === 'player_moved') {
                if (data.id === myId) {
                    myX = data.x;
                    myY = data.y;
                    if (playersInfo[myId]) {
                        playersInfo[myId].x = myX;
                        playersInfo[myId].y = myY;
                    }
                } else if (playersInfo[data.id]) {
                    playersInfo[data.id].x = data.x;
                    playersInfo[data.id].y = data.y;
                    if (data.dirX !== undefined) playersInfo[data.id].dirX = data.dirX;
                    if (data.dirY !== undefined) playersInfo[data.id].dirY = data.dirY;
                }
            } else if (data.type === 'bot_moved') {
                if (botsInfo[data.id]) {
                    botsInfo[data.id].targetX = data.x;
                    botsInfo[data.id].targetY = data.y;
                    // Initial snap if first move
                    if (botsInfo[data.id].x === undefined) {
                        botsInfo[data.id].x = data.x;
                        botsInfo[data.id].y = data.y;
                    }
                }
            } else if (data.type === 'bot_removed') {
                if (botsInfo[data.id] && botsInfo[data.id].botType === 'slime') {
                    score += 10 + currentWave * 5;
                    updateScoreUI();
                }
                delete botsInfo[data.id];
            } else if (data.type === 'effects_applied') {
                if (data.isBot && botsInfo[data.id]) {
                    botsInfo[data.id].effects = data.effects;
                } else if (!data.isBot && playersInfo[data.id]) {
                    playersInfo[data.id].effects = data.effects;
                }
            } else if (data.type === 'projectile_spawn') {
                projectilesInfo[data.projectile.id] = data.projectile;
            } else if (data.type === 'projectile_destroyed') {
                delete projectilesInfo[data.id];
            } else if (data.type === 'player_hit') {
                if (playersInfo[data.id]) playersInfo[data.id].hp = data.hp;
            } else if (data.type === 'bot_hit') {
                if (botsInfo[data.id]) {
                    botsInfo[data.id].hp = data.hp;
                    logDebug(`Hit Bot: ${data.id} - HP: ${data.hp}`);
                    // Visual feedback: Spark explosion on hit
                    for (let i = 0; i < 10; i++) {
                        particles.push({
                            type: 'spark', x: data.x, y: data.y,
                            vx: (Math.random() - 0.5) * 15,
                            vy: (Math.random() - 0.5) * 15,
                            life: 1.0, color1: '#ffaa00', size: 6 + Math.random() * 10
                        });
                    }
                }
            } else if (data.type === 'wave_incoming') {
                showWaveBanner(data.waveNumber, 5);
                updateWaveUI(data.waveNumber);
            } else if (data.type === 'wave_countdown') {
                updateWaveBannerCount(data.count);
            } else if (data.type === 'game_over') {
                if (data.id === myId) showGameOver();
            }
        },
        (playerEvent) => console.log('Player Event from Server:', playerEvent)
    );

    // Wave Banner Logic
    let waveBannerTimer = null;
    const waveBanner = document.getElementById('wave-banner');
    const waveBannerText = document.getElementById('wave-banner-text');
    const waveCountdownEl = document.getElementById('wave-countdown');

    function showWaveBanner(waveNum, countStart) {
        if (!waveBanner) return;
        if (waveBannerText) waveBannerText.textContent = `WAVE ${waveNum}`;
        if (waveCountdownEl) waveCountdownEl.textContent = countStart;
        waveBanner.classList.remove('hidden');
    }
    function updateWaveBannerCount(count) {
        if (waveCountdownEl) waveCountdownEl.textContent = count;
        if (count <= 0 && waveBanner) waveBanner.classList.add('hidden');
    }

    // Game Over Logic
    let isGameOver = false;
    function showGameOver() {
        isGameOver = true;
        const goScreen = document.getElementById('game-over');
        if (!goScreen) return;
        const goScoreEl = document.getElementById('go-score-value');
        const goWaveEl = document.getElementById('go-wave-value');
        if (goScoreEl) goScoreEl.textContent = score;
        if (goWaveEl) goWaveEl.textContent = currentWave;
        goScreen.classList.remove('hidden');
    }

    let vision = null;
    let gameStarted = false;

    function startGame(mode) {
        // Reset Local State
        isGameOver = false;
        score = 0;
        currentWave = 1;
        myX = 1500;
        myY = 1500;
        updateScoreUI();
        updateWaveUI(1);
        
        // Clear old overlays
        if (waveBanner) waveBanner.classList.add('hidden');
        const goScreen = document.getElementById('game-over');
        if (goScreen) goScreen.classList.add('hidden');

        document.getElementById('main-menu').style.display = 'none';
        document.getElementById('battlefield').style.display = 'block';
        
        // Notify server with slight delay to ensure client is ready
        setTimeout(() => {
            if (network && network.socket.readyState === WebSocket.OPEN) {
                network.socket.send(JSON.stringify({ type: 'request_mode', mode: mode }));
            }
        }, 300);

        if (!vision) {
            try {
                vision = new VisionSubsystem(videoElement, visionCanvas);
                logDebug("Vision Subsystem initialized.");
                
                // Set Up Vision Handlers
                vision.onElementCasted = (element) => {
                    console.log("Casted:", element);
                    currentElementSpan.innerText = element;
                    currentElementSpan.style.color = getElementColor(element);
                    network.sendSpellCast(element, myX, myY, myDirX, myDirY);

                    const col = getElementColor(element);
                    const now = performance.now();
                    for (let i = 0; i < 6; i++) {
                        particles.push({
                            type: 'spark', x: myX, y: myY,
                            vx: (seededRand(i + now) - 0.5) * 12,
                            vy: (seededRand(i * 2 + now) - 0.5) * 12,
                            life: 1.0, color1: col, size: 8 + seededRand(i) * 12
                        });
                    }
                };

                vision.onMasterSpellCasted = (spellName) => {
                    console.log("MASTER SPELL:", spellName);
                    masterSpellAlert.innerText = `🔥 ${spellName} 🔥`;
                    masterSpellAlert.classList.add('active');
                    setTimeout(() => {
                        masterSpellAlert.classList.remove('active');
                        currentElementSpan.innerText = "None";
                        currentElementSpan.style.color = "#fff";
                    }, 3000);
                    network.sendMasterSpell(spellName, null, null, myX, myY, myDirX, myDirY);
                };

                vision.onRuneUpdate = (state) => {
                    if (!state) {
                        currentElementSpan.innerText = "None";
                        currentElementSpan.style.color = "#fff";
                        currentElementSpan.style.textShadow = "none";
                    } else if (state === 'charging') {
                        currentElementSpan.innerText = "Drawing...";
                        currentElementSpan.style.color = "#aaa";
                        currentElementSpan.style.textShadow = "none";
                    } else {
                        currentElementSpan.innerText = `${state} (Charged)`;
                        currentElementSpan.style.color = getElementColor(state);
                        currentElementSpan.style.textShadow = `0 0 10px ${getElementColor(state)}`;
                    }
                };
            } catch (e) {
                logDebug("Vision Error: " + e.message);
            }
        }

        if (!gameStarted) {
            gameStarted = true;
            requestAnimationFrame(gameLoop);
        }
    }

    document.getElementById('btn-practice').addEventListener('click', () => startGame('practice'));
    document.getElementById('btn-waves').addEventListener('click', () => startGame('waves'));
    document.getElementById('btn-quit').addEventListener('click', () => location.reload());
    const btnRestart = document.getElementById('btn-restart');
    const btnGoMenu = document.getElementById('btn-go-menu');
    if (btnRestart) btnRestart.addEventListener('click', () => { isGameOver = false; score = 0; updateScoreUI(); location.reload(); });
    if (btnGoMenu) btnGoMenu.addEventListener('click', () => location.reload());



    // Auxiliary UI logic
    function getElementColor(el) {
        const colors = {
            'Fire': '#ff4400',   // Neon Orange-Red
            'Water': '#00aaff',  // Brilliant Blue
            'Earth': '#33ff00',  // Toxic Green
            'Wind': '#ffffff'    // Pure White
        };
        return colors[el] || '#fff';
    }

    function spawnRuneInCenter(element) {
        // Create a floating rune DOM element temporarily
        const el = document.createElement('div');
        el.className = `rune active ${element.toLowerCase()}`;
        const symbols = { 'Fire': '▲', 'Water': '◯', 'Earth': '■', 'Wind': '≈' };
        el.innerText = symbols[element] || element;
        // Center of screen
        el.style.left = '50%';
        el.style.top = '50%';

        runeContainer.appendChild(el);

        // Remove after animation finishes
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translate(-50%, -150%) scale(1.5)';
            setTimeout(() => {
                if (runeContainer.contains(el)) runeContainer.removeChild(el);
            }, 500);
        }, 800);
    }

    // Game Canvas
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Off-screen canvas for pixel art rendering
    const pixelCanvas = document.createElement('canvas');
    pixelCanvas.width = 64;
    pixelCanvas.height = 64;
    const pCtx = pixelCanvas.getContext('2d');

    // Helper: draw a pixel block on the offscreen pixel canvas
    function px(c, col, x, y, w, h) { c.fillStyle = col; c.fillRect(x, y, w, h); }

    // Procedural Mage Renderer (Pure Pixel Art — all fillRect, no arcs)
    function drawProceduralMage(mainCtx, x, y, dx, dy, alignment, time) {
        let robeC = '#1f488f', robeDk = '#153368';
        let hatC = '#d9b52a', hatDk = '#9e7a12';
        let glowColor = null;

        if (alignment) {
            let maxVal = 0, dom = 'None';
            for (let el in alignment) { if (alignment[el] > maxVal) { maxVal = alignment[el]; dom = el; } }
            if (maxVal > 0) {
                if (dom === 'Fire') { robeC = '#b3241b'; robeDk = '#7a1210'; hatC = '#cc3300'; hatDk = '#882200'; glowColor = '#ff3300'; }
                else if (dom === 'Water') { robeC = '#1b6bb3'; robeDk = '#0f3f7a'; hatC = '#0077cc'; hatDk = '#004b88'; glowColor = '#00ccff'; }
                else if (dom === 'Earth') { robeC = '#2d7a1b'; robeDk = '#1a5010'; hatC = '#449922'; hatDk = '#2d6614'; glowColor = '#66cc00'; }
                else if (dom === 'Wind') { robeC = '#8090b0'; robeDk = '#556080'; hatC = '#aab8cc'; hatDk = '#778898'; glowColor = '#cce0ff'; }
            }
        }

        const isFacingUp = dy < -0.1;
        const isFacingLeft = dx < -0.1;
        const isFacingRight = dx > 0.1;
        // 2-frame bob: shift 1px every 250ms
        const bob = Math.floor(time / 250) % 2;

        pCtx.clearRect(0, 0, 64, 64);
        pCtx.imageSmoothingEnabled = false;
        const C = pCtx;
        const BK = '#000';
        // All coordinates are absolute on the 64x64 pixel canvas
        // Character anchor: feet at (32, 56)
        const FX = 32, FY = 56 + bob; // foot anchor

        // ---- ROBE ---------------------------------------------------
        // Body block (trapezoid approximated with rects)
        px(C, BK, FX - 8, FY - 22, 16, 18);   // outline
        px(C, robeC, FX - 7, FY - 21, 14, 16);   // fill
        px(C, robeDk, FX - 7, FY - 21, 3, 16);    // left shadow stripe
        px(C, robeDk, FX + 4, FY - 21, 3, 5);     // right top shadow
        // Hem flare
        px(C, BK, FX - 10, FY - 6, 20, 8);
        px(C, robeC, FX - 9, FY - 5, 18, 6);
        px(C, robeDk, FX - 9, FY - 5, 3, 6);

        // ---- HEAD ---------------------------------------------------
        const hFaceX = FX + (isFacingLeft ? -3 : isFacingRight ? 3 : 0);
        if (!isFacingUp) {
            // Head (pixelated circle = 6x6 with corners cut)
            px(C, BK, hFaceX - 5, FY - 34, 10, 10);
            px(C, '#0a0a0a', hFaceX - 4, FY - 33, 8, 8);
            // corner cuts
            px(C, BK, hFaceX - 4, FY - 33, 1, 1);
            px(C, BK, hFaceX + 3, FY - 33, 1, 1);
            px(C, BK, hFaceX - 4, FY - 26, 1, 1);
            px(C, BK, hFaceX + 3, FY - 26, 1, 1);
            // Eyes (2x2 pixels each, yellow)
            const eyeCol = glowColor || '#ffe000';
            if (!isFacingRight) px(C, eyeCol, hFaceX - 3, FY - 31, 2, 2);
            if (!isFacingLeft) px(C, eyeCol, hFaceX + 1, FY - 31, 2, 2);
        } else {
            // Back of head — just dark lump
            px(C, BK, FX - 5, FY - 34, 10, 8);
            px(C, '#111', FX - 4, FY - 33, 8, 6);
        }

        // ---- HAT ---------------------------------------------------
        const hX = FX + (isFacingLeft ? -3 : isFacingRight ? 3 : 0);
        const lean = isFacingLeft ? -5 : isFacingRight ? 5 : 0;
        // Brim (flat wide block)
        px(C, BK, hX - 11, FY - 37, 22, 3);
        px(C, hatC, hX - 10, FY - 36, 20, 2);
        // Shaft row 1 (base)
        px(C, BK, hX - 7 + Math.round(lean * 0.2), FY - 43, 14, 7);
        px(C, hatC, hX - 6 + Math.round(lean * 0.2), FY - 42, 12, 6);
        px(C, hatDk, hX - 6 + Math.round(lean * 0.2), FY - 42, 3, 6);
        // Shaft row 2 (mid)
        px(C, BK, hX - 5 + Math.round(lean * 0.5), FY - 49, 10, 7);
        px(C, hatC, hX - 4 + Math.round(lean * 0.5), FY - 48, 8, 6);
        px(C, hatDk, hX - 4 + Math.round(lean * 0.5), FY - 48, 2, 6);
        // Shaft row 3 (tip)
        px(C, BK, hX - 2 + lean, FY - 55, 6, 7);
        px(C, hatC, hX - 1 + lean, FY - 54, 4, 6);
        // Tip pixel
        px(C, hatC, hX + lean, FY - 57, 2, 2);

        // ---- STAFF -------------------------------------------------
        if (!isFacingUp) {
            const sX = isFacingLeft ? FX + 6 : FX - 9;
            px(C, '#3d2511', sX, FY - 30, 2, 26);  // shaft
            px(C, '#5c3a1e', sX - 1, FY - 30, 1, 26);  // highlight
            // Orb (2x2 pixel block + glow colour)
            const orbC = glowColor || '#aaaaaa';
            px(C, BK, sX - 2, FY - 34, 6, 6);
            px(C, orbC, sX - 1, FY - 33, 4, 4);
            px(C, '#fff', sX, FY - 33, 2, 2); // highlight
        }

        // ---- Blit to main context ----------------------------------
        mainCtx.save();
        mainCtx.imageSmoothingEnabled = false;
        if (glowColor) {
            mainCtx.shadowBlur = 22;
            mainCtx.shadowColor = glowColor;
        }
        const scale = 4;
        mainCtx.drawImage(pixelCanvas,
            x - FX * scale,
            y - FY * scale,
            64 * scale, 64 * scale);
        mainCtx.restore();
    }

    // ── Seeded deterministic pseudo-random ──────────────────────────────────
    function seededRand(seed) {
        const x = Math.sin(seed + 1) * 43758.5453123;
        return x - Math.floor(x);
    }

    // Cache crack geometry per tile (computed once)
    const crackCache = {};
    function getCracks(gx, gy) {
        const key = `${gx},${gy}`;
        if (!crackCache[key]) {
            const a = seededRand(gx * 317 + gy * 1031);
            const b = seededRand(gx * 919 + gy * 277);
            const c = seededRand(gx * 1553 + gy * 641);
            crackCache[key] = [
                { x1: a * 0.5 - 0.25, y1: b * 0.4 - 0.2, x2: c * 0.4, y2: a * 0.4 - 0.2 },
                { x1: b * 0.35, y1: c * 0.4 - 0.2, x2: a * 0.3 + 0.1, y2: b * 0.35 }
            ];
        }
        return crackCache[key];
    }

    // Isometric tile dimensions (screen pixels)
    const ISO_TW = 128;
    const ISO_TH = 64;
    const GRID_N = 48; // Fills 3072px vertically (48 * 64)

    function isoToScreen(gx, gy) {
        return {
            sx: (gx - gy) * (ISO_TW / 2),
            sy: (gx + gy) * (ISO_TH / 2)
        };
    }

    function isoDiamond(ctx, sx, sy) {
        ctx.beginPath();
        ctx.moveTo(sx, sy - ISO_TH / 2);
        ctx.lineTo(sx + ISO_TW / 2, sy);
        ctx.lineTo(sx, sy + ISO_TH / 2);
        ctx.lineTo(sx - ISO_TW / 2, sy);
        ctx.closePath();
    }

    // ── BACKGROUND PRE-RENDERING OPTIMIZATION ────────────────────────────────
    const staticBGCanvas = document.createElement('canvas');
    staticBGCanvas.width = 3000;
    staticBGCanvas.height = 3000;
    const staticBGCtx = staticBGCanvas.getContext('2d');
    let isBGReady = false;

    function preRenderBackground() {
        logDebug("Starting Background Pre-render (Optimization)...");

        staticBGCtx.fillStyle = '#030210';
        staticBGCtx.fillRect(0, 0, 3000, 3000);

        const originX = 1500;
        const originY = 0; 

        for (let gy = 0; gy < GRID_N; gy++) {
            for (let gx = 0; gx < GRID_N; gx++) {
                const { sx, sy } = isoToScreen(gx, gy);
                const wx = originX + sx;
                const wy = originY + sy;

                const r = seededRand(gx * 73 + gy * 137);
                const r2 = seededRand(gx * 211 + gy * 53);
                const r3 = seededRand(gx * 157 + gy * 389);

                const isEdge = gx === 0 || gy === 0 || gx === GRID_N - 1 || gy === GRID_N - 1;
                const isCracked = !isEdge && r > 0.60;

                const baseCol = isEdge ? '#06050d'
                    : r > 0.80 ? '#1c2235'
                        : r > 0.50 ? '#141b2a'
                            : '#0f1520';

                isoDiamond(staticBGCtx, wx, wy);
                staticBGCtx.fillStyle = baseCol;
                staticBGCtx.fill();

                staticBGCtx.save();
                staticBGCtx.globalAlpha = 0.06 + r2 * 0.06;
                staticBGCtx.beginPath();
                staticBGCtx.moveTo(wx, wy - ISO_TH / 2);
                staticBGCtx.lineTo(wx + ISO_TW / 2, wy);
                staticBGCtx.lineTo(wx, wy);
                staticBGCtx.closePath();
                staticBGCtx.fillStyle = '#b8d8ff';
                staticBGCtx.fill();
                staticBGCtx.restore();

                staticBGCtx.save();
                staticBGCtx.globalAlpha = 0.10 + r * 0.06;
                staticBGCtx.beginPath();
                staticBGCtx.moveTo(wx - ISO_TW / 2, wy);
                staticBGCtx.lineTo(wx, wy + ISO_TH / 2);
                staticBGCtx.lineTo(wx, wy);
                staticBGCtx.closePath();
                staticBGCtx.fillStyle = '#000015';
                staticBGCtx.fill();
                staticBGCtx.restore();

                isoDiamond(staticBGCtx, wx, wy);
                staticBGCtx.strokeStyle = 'rgba(80, 120, 200, 0.04)';
                staticBGCtx.lineWidth = 0.8;
                staticBGCtx.stroke();

                if (isCracked) {
                    const cracks = getCracks(gx, gy);
                    staticBGCtx.save();
                    staticBGCtx.globalAlpha = 0.45 + r3 * 0.3;
                    for (const c of cracks) {
                        staticBGCtx.strokeStyle = '#000010'; staticBGCtx.lineWidth = 1.0;
                        staticBGCtx.beginPath();
                        staticBGCtx.moveTo(wx + c.x1 * ISO_TW, wy + c.y1 * ISO_TH);
                        staticBGCtx.lineTo(wx + c.x2 * ISO_TW, wy + c.y2 * ISO_TH);
                        staticBGCtx.stroke();
                    }
                    staticBGCtx.restore();
                }
            }
        }
        isBGReady = true;
        logDebug("Background Pre-render Complete.");
    }
    setTimeout(preRenderBackground, 500);

    const RUNE_PATTERNS = [
        [[-0.05, -0.3], [-0.05, 0.3], [0.05, -0.3], [0.05, 0.3]],
        [[-0.3, 0], [0.3, 0], [-0.2, -0.2], [0.2, 0.2]],
        [[-0.25, -0.25], [0.25, 0.25], [-0.25, 0.25], [0.25, -0.25]],
        [[0, -0.3], [0.2, 0.1], [-0.2, 0.1], [0, 0.3]],
    ];

    // ── Rich Isometric Floor Renderer ────────────────────────────────────────
    function drawProceduralBackground(ctx, camX, camY, time) {
        if (isBGReady) {
            ctx.drawImage(staticBGCanvas, 0, 0);
        } else {
            ctx.fillStyle = '#030210';
            ctx.fillRect(0, 0, 3000, 3000);
        }

        const originX = 1500;
        const originY = 0;

        // LIGHTWEIGHT PASS for dynamic elements only
        const rangeX = canvas.width / 2 + 100;
        const rangeY = canvas.height / 2 + 100;

        for (let gy = 0; gy < GRID_N; gy++) {
            for (let gx = 0; gx < GRID_N; gx++) {
                const { sx, sy } = isoToScreen(gx, gy);
                const wx = originX + sx;
                const wy = originY + sy;

                if (wx < camX - rangeX || wx > camX + rangeX || wy < camY - rangeY || wy > camY + rangeY) continue;

                const r = seededRand(gx * 73 + gy * 137);
                const r2 = seededRand(gx * 211 + gy * 53);
                const r3 = seededRand(gx * 157 + gy * 389);
                const isEdge = gx === 0 || gy === 0 || gx === GRID_N - 1 || gy === GRID_N - 1;
                const isRune = !isEdge && seededRand(gx * 401 + gy * 601) > 0.945;
                const isGlow = !isEdge && r2 > 0.85;

                if (isGlow) {
                    const phase = time / 2200 + gx * 0.91 + gy * 1.37;
                    const pulse = 0.5 + 0.5 * Math.sin(phase);
                    const glows = ['rgba(90,20,210,', 'rgba(30,50,200,', 'rgba(150,20,255,'];
                    const gc = glows[Math.floor(r3 * glows.length)];
                    const a = (0.05 + pulse * 0.05).toFixed(3);
                    isoDiamond(ctx, wx, wy);
                    ctx.fillStyle = `${gc}${a})`;
                    ctx.fill();
                }

                if (isRune) {
                    const rp = RUNE_PATTERNS[Math.floor(r * RUNE_PATTERNS.length)];
                    const runeA = (0.12 + 0.08 * Math.sin(time / 1600 + gx * 2.1 + gy * 1.9)).toFixed(3);
                    ctx.save();
                    ctx.strokeStyle = `rgba(160, 80, 255, ${runeA})`;
                    ctx.lineWidth = 1.0;
                    for (let i = 0; i + 1 < rp.length; i += 2) {
                        ctx.beginPath();
                        ctx.moveTo(wx + rp[i][0] * ISO_TW * 0.6, wy + rp[i][1] * ISO_TH * 0.6);
                        ctx.lineTo(wx + rp[i + 1][0] * ISO_TW * 0.6, wy + rp[i + 1][1] * ISO_TH * 0.6);
                        ctx.stroke();
                    }
                    ctx.restore();
                }
            }
        }

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (let m = 0; m < 14; m++) {
            const mA = seededRand(m * 999 + 1);
            const mB = seededRand(m * 444 + 7);
            const mW = originX + (mA - 0.5) * GRID_N * ISO_TW * 0.6;
            const mH = originY + (mB - 0.3) * GRID_N * ISO_TH * 0.5;
            const sz = 120 + seededRand(m * 777) * 180;
            const alpha = 0.018 + 0.01 * Math.sin(time / 5000 + m * 1.7);
            const g = ctx.createRadialGradient(mW, mH, 0, mW, mH, sz);
            g.addColorStop(0, `rgba(70, 25, 160, ${alpha})`);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(mW, mH, sz, sz * 0.3, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawTrainingDummy(mainCtx, x, y, time) {
        // Wooden / Straw Dummy Colors
        const woodBody = '#8B4513'; // SaddleBrown
        const woodDk = '#5D2E0C';
        const rope = '#D2B48C'; // Tan

        const bob = Math.floor(time / 400) % 2;

        pCtx.clearRect(0, 0, 64, 64);
        pCtx.imageSmoothingEnabled = false;
        const C = pCtx;
        const BK = '#000';
        const FX = 32, FY = 56 + bob;

        // Base/Stand
        px(C, BK, FX - 12, FY - 4, 24, 6);
        px(C, woodDk, FX - 11, FY - 3, 22, 4);

        // Main Post
        px(C, BK, FX - 3, FY - 35, 6, 32);
        px(C, woodBody, FX - 2, FY - 34, 4, 30);

        // Arms Crossbar
        px(C, BK, FX - 15, FY - 30, 30, 6);
        px(C, woodBody, FX - 14, FY - 29, 28, 4);

        // Head (Straw block)
        px(C, BK, FX - 6, FY - 45, 12, 12);
        px(C, '#C2B280', FX - 5, FY - 44, 10, 10); // Straw color
        px(C, woodDk, FX - 3, FY - 40, 2, 2); // Eye 1
        px(C, woodDk, FX + 1, FY - 40, 2, 2); // Eye 2

        // Bindings
        px(C, rope, FX - 14, FY - 28, 2, 2);
        px(C, rope, FX + 12, FY - 28, 2, 2);

        const scale = 4;
        mainCtx.save();
        mainCtx.imageSmoothingEnabled = false;
        mainCtx.drawImage(pixelCanvas, x - FX * scale, y - FY * scale, 64 * scale, 64 * scale);
        mainCtx.restore();
    }

    // Game Loop

    let lastTime = performance.now();
    function gameLoop(time) {
        lastTime = time;

        if (isGameOver) {
            requestAnimationFrame(gameLoop);
            return;
        }

        // 1. Core Logic (Simple 2D Movement)
        let moved = false;
        let dX = 0, dY = 0;
        
        let canMove = true;
        let currentSpeed = speed;
        
        // Apply status effects locally for accurate prediction & physics
        let myEffects = null;
        if (myId && playersInfo[myId] && playersInfo[myId].effects) {
            myEffects = playersInfo[myId].effects;
        }
        
        if (myEffects) {
            if (myEffects['stun']) canMove = false;
            // Cap speed modulation if slow exists
            if (myEffects['slow']) currentSpeed = speed * (myEffects['slow'].speedMod || 0.5);
        }

        if (canMove) {
            if (keys.w) { dY = -1; moved = true; }
            if (keys.s) { dY = 1; moved = true; }
            if (keys.a) { dX = -1; moved = true; }
            if (keys.d) { dX = 1; moved = true; }
        }

        // Update facing direction if any key is held (even if not moving)
        if (keys.w || keys.s || keys.a || keys.d) {
            const len = Math.hypot(dX, dY);
            myDirX = dX / (len || 1);
            myDirY = dY / (len || 1);
        }

        if (moved) {
            // Apply movement (Cartesian)
            const moveLen = Math.hypot(dX, dY);
            const moveX = dX / (moveLen || 1);
            const moveY = dY / (moveLen || 1);
            
            myX = Math.max(100, Math.min(2900, myX + moveX * currentSpeed));
            myY = Math.max(100, Math.min(2900, myY + moveY * currentSpeed));
            
            network.sendMove(myX, myY, myDirX, myDirY);
            if (myId && playersInfo[myId]) {
                playersInfo[myId].x = myX;
                playersInfo[myId].y = myY;
                playersInfo[myId].dirX = myDirX;
                playersInfo[myId].dirY = myDirY;
            }
        }

        // 2. Prep Rendering
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let camX = myX;
        let camY = myY;
        if (canvas.width < 3000) camX = Math.max(canvas.width / 2, Math.min(3000 - canvas.width / 2, myX));
        else camX = 1500;
        if (canvas.height < 3000) camY = Math.max(canvas.height / 2, Math.min(3000 - canvas.height / 2, myY));
        else camY = 1500;

        ctx.save();
        ctx.translate(canvas.width / 2 - camX, canvas.height / 2 - camY);

        // 3. Render Map
        drawProceduralBackground(ctx, camX, camY, time);
        
        ctx.restore(); // END CAMERA for map only for now? No, we still want entities in world space.
        
        // --- ENTITY LAYER (FORCED TOP) ---
        ctx.save();
        ctx.translate(canvas.width / 2 - camX, canvas.height / 2 - camY);
        
        // Ensure entities are NOT hidden by a full-screen clear or something else
        ctx.globalAlpha = 1.0;

        // 4. Sort Entities (Players, Bots, Projectiles)
        const allEntities = [];
        for (const id in playersInfo) {
            allEntities.push({ type: 'player', id, data: playersInfo[id], renderY: playersInfo[id].y || 0 });
        }
        for (const id in botsInfo) {
            let b = botsInfo[id];
            // Lerp towards target position for smooth 60fps movement
            if (b.targetX !== undefined) {
                b.x += (b.targetX - b.x) * 0.35;
                b.y += (b.targetY - b.y) * 0.35;
            }
            allEntities.push({ type: 'bot', id, data: b, renderY: b.y });
        }
        for (const id in projectilesInfo) {
            let p = projectilesInfo[id];
            p.x += (p.dx || 0) * (p.speed || 1);
            p.y += (p.dy || 0) * (p.speed || 1);
            p.life = (p.life || 0) + 1;
            if (!p.history) p.history = [];
            p.history.push({ x: p.x, y: p.y, time: time });
            if (p.history.length > 10) p.history.shift();

            // Lightweight Sparks spawn
            if (time % 2 === 0) {
                particles.push({
                    type: 'spark', x: p.x, y: p.y,
                    vx: (p.dx * -3) + (seededRand(time) - 0.5) * 6,
                    vy: (p.dy * -3) + (seededRand(time + 1) - 0.5) * 6,
                    life: 1.0, size: 8 + seededRand(time + 2) * 10,
                    color1: p.element === 'master' ? getElementColor(p.el1) : getElementColor(p.element)
                });
            }
            if (p.life > 120) delete projectilesInfo[id];
            else allEntities.push({ type: 'projectile', id, data: p, renderY: p.y });
        }

        allEntities.sort((a, b) => a.renderY - b.renderY);

        // 5. Drawing Pass
        for (const entity of allEntities) {
            
            // Render Status Effect Auras
            let eff = entity.data.effects;
            if (eff) {
                const ex = entity.data.x !== undefined ? entity.data.x : (entity.type === 'player' ? 1500 : 0);
                const ey = entity.data.y !== undefined ? entity.data.y : (entity.type === 'player' ? 1500 : 0);
                
                if (eff['stun']) {
                    ctx.save();
                    ctx.fillStyle = 'rgba(120, 90, 40, 0.4)'; // Muddy Brown aura
                    ctx.beginPath(); ctx.ellipse(ex, ey + 15, 45, 20, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                }
                if (eff['slow']) {
                    ctx.save();
                    ctx.fillStyle = 'rgba(100, 200, 255, 0.3)'; // Frost blue aura
                    ctx.beginPath(); ctx.ellipse(ex, ey + 15, 35, 15, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                }
                if (eff['burn']) {
                    // Spawn tiny flame particles above them randomly
                    if (Math.random() < 0.2) {
                        particles.push({
                            type: 'spark', x: ex + (Math.random()-0.5)*30, y: ey - 50 + (Math.random()-0.5)*40,
                            vx: 0, vy: -3, life: 1.0, color1: '#ff4400', size: 3 + Math.random()*4
                        });
                    }
                }
            }

            if (entity.type === 'player') {
                const p = entity.data;
                const isMe = parseInt(entity.id) === myId;
                const px = p.x !== undefined ? p.x : 1500;
                const py = p.y !== undefined ? p.y : 1500;
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.beginPath(); ctx.ellipse(px, py + 15, 25, 12, 0, 0, Math.PI * 2); ctx.fill();
                if (!p.alignment) p.alignment = { Fire: 0, Water: 0, Earth: 0, Wind: 0 };
                drawProceduralMage(ctx, px, py, (isMe ? myDirX : (p.dirX || 0)), (isMe ? myDirY : (p.dirY || 0)), p.alignment, time);
                ctx.fillStyle = '#fff'; ctx.font = '16px "Press Start 2P"'; ctx.textAlign = 'center';
                ctx.fillText(isMe ? 'You' : `Mage ${entity.id}`, px, py - 95);
                ctx.fillStyle = '#f00'; ctx.fillRect(px - 20, py - 80, 40, 5);
                ctx.fillStyle = '#0f0'; ctx.fillRect(px - 20, py - 80, (p.hp || 100) / 100 * 40, 5);
            } else if (entity.type === 'bot') {
                const b = entity.data;
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.beginPath(); ctx.ellipse(b.x, b.y + 10, 35, 15, 0, 0, Math.PI * 2); ctx.fill();
                
                if (b.botType === 'slime') {
                    const sz = 40;
                    // id parser to get some random seed for bobbing
                    const seed = parseInt(b.id.replace(/\D/g, '')) || 0;
                    const bounce = Math.abs(Math.sin((time + seed * 100) / 150)) * 10;
                    
                    ctx.save();
                    ctx.translate(b.x, b.y - 15 - bounce);
                    
                    // Slime base color (Neon purple), red if low HP
                    ctx.fillStyle = b.hp < ((b.maxHp || 40) / 2) ? '#ff0055' : '#a220ff';
                    if (b.effects && b.effects.burn) ctx.fillStyle = '#ff4400';
                    if (b.effects && b.effects.slow) ctx.fillStyle = '#00aaff';
                    if (b.effects && b.effects.stun) ctx.fillStyle = '#9c7a62';

                    ctx.beginPath();
                    ctx.ellipse(0, 0, sz * 0.7, sz * 0.6 + bounce * 0.5, 0, 0, Math.PI * 2);
                    ctx.fill();
                    
                    // Inner glowing core
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
                    ctx.ellipse(0, -10, sz * 0.4, sz * 0.3, 0, 0, Math.PI * 2);
                    ctx.fill();
                    
                    // Eyes
                    ctx.fillStyle = '#111';
                    ctx.fillRect(-15, -10, 8, 8);
                    ctx.fillRect(5, -10, 8, 8);
                    ctx.fillStyle = '#fffc';
                    ctx.fillRect(-12, -7, 3, 3);
                    ctx.fillRect(8, -7, 3, 3);
                    
                    ctx.restore();

                    ctx.fillStyle = '#aaa'; ctx.font = '10px "Press Start 2P"'; ctx.textAlign = 'center';
                    ctx.fillText('SLIME', b.x, b.y - 80);
                    ctx.fillStyle = '#555'; ctx.fillRect(b.x - 20, b.y - 70, 40, 4);
                    // Draw HP Bar
                    const hpRatio = Math.max(0, b.hp / (b.maxHp || 40));
                    ctx.fillStyle = '#0f0'; ctx.fillRect(b.x - 20, b.y - 70, hpRatio * 40, 4);
                } else {
                    drawTrainingDummy(ctx, b.x, b.y, time);
                    ctx.fillStyle = '#aaa'; ctx.font = '12px "Press Start 2P"'; ctx.textAlign = 'center';
                    ctx.fillText('TRAINING DUMMY', b.x, b.y - 100);
                    ctx.fillStyle = '#555'; ctx.fillRect(b.x - 30, b.y - 90, 60, 4);
                    ctx.fillStyle = '#ffaa00'; ctx.fillRect(b.x - 30, b.y - 90, (b.hp / (b.maxHp || 100)) * 60, 4);
                }
            } else if (entity.type === 'projectile') {
                const p = entity.data;
                const angle = Math.atan2(p.dy, p.dx);
                const sz = 16, zH = 45;
                ctx.save();
                ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(p.x - 12, p.y - 6, 24, 12);
                ctx.translate(p.x, p.y - zH); ctx.rotate(angle);
                const element = p.element || 'Fire';
                const col = getElementColor(element === 'master' ? (p.el1 || 'Fire') : element);
                ctx.fillStyle = col; ctx.fillRect(-sz, -sz, sz * 2, sz * 2);
                ctx.fillStyle = '#fff'; ctx.fillRect(0, -sz / 2, sz, sz);
                ctx.restore();
            }
        }

        // 6. Projectile Trails
        for (const id in projectilesInfo) {
            const p = projectilesInfo[id];
            if (!p.history || p.history.length < 2) continue;
            const element = p.element || 'Fire';
            const col = getElementColor(element === 'master' ? (p.el1 || 'Fire') : element);
            const zH = 45, sz = 12, skip = 3;
            ctx.save();
            for (let i = 0; i < p.history.length; i += skip) {
                const ratio = i / p.history.length;
                ctx.globalAlpha = ratio * 0.6; ctx.fillStyle = col;
                ctx.fillRect(p.history[i].x - sz / 2, p.history[i].y - zH - sz / 2, sz, sz);
            }
            ctx.restore();
        }

        // 7. Particles
        ctx.save();
        for (let i = particles.length - 1; i >= 0; i--) {
            let pt = particles[i];
            pt.life -= 0.05;
            if (pt.life <= 0) { particles.splice(i, 1); continue; }
            pt.x += (pt.vx || 0); pt.y += (pt.vy || 0);
            ctx.globalAlpha = pt.life; ctx.fillStyle = pt.color1;
            ctx.fillRect(pt.x - pt.size / 2, pt.y - 45 - pt.size / 2, pt.size, pt.size);
            if (pt.life > 0.6) {
                ctx.fillStyle = '#fff'; ctx.fillRect(pt.x - pt.size / 4, pt.y - 45 - pt.size / 4, pt.size / 2, pt.size / 2);
            }
        }
        if (particles.length > 80) particles.splice(0, particles.length - 80);
        ctx.restore();

        ctx.restore();

        // 8. Off-Screen Enemy Indicators (Wave Defense only)
        for (const id in botsInfo) {
            const b = botsInfo[id];
            if (b.botType !== 'slime') continue; // Only track living enemies
            const screenX = (canvas.width / 2 - camX) + b.x;
            const screenY = (canvas.height / 2 - camY) + b.y;
            
            if (screenX < 0 || screenX > canvas.width || screenY < 0 || screenY > canvas.height) {
                const angle = Math.atan2(screenY - canvas.height/2, screenX - canvas.width/2);
                const ex = canvas.width/2 + Math.cos(angle) * (Math.min(canvas.width, canvas.height) * 0.4);
                const ey = canvas.height/2 + Math.sin(angle) * (Math.min(canvas.width, canvas.height) * 0.4);
                ctx.fillStyle = '#a220ff';
                ctx.beginPath(); ctx.arc(ex, ey, 10, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = '#fff'; ctx.font = '8px "Press Start 2P"'; ctx.textAlign = 'center';
                ctx.fillText('!', ex, ey + 4);
            }
        }
        
        // 9. Restore Coordination & Finalize
        ctx.restore();
        if (gameStarted) requestAnimationFrame(gameLoop);
    }
    // Loop is now started by startGame()
});
