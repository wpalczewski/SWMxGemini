// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Game State
let globalGameMode = 'menu'; // menu, practice, waves
let waveNumber = 1;
let waveScheduled = false;  // Guard: prevent multiple wave timers
let waveActive = false;     // True while slimes are alive and attacking
let waveTimer = null;       // Store the current wave countdown interval

const players = {};
const projectiles = {};
let bots = {};
let nextId = 1;
let projNextId = 1;
let botNextId = 1;

function resetPractice() {
    globalGameMode = 'practice';
    waveActive = false;
    waveScheduled = false;
    if (waveTimer) clearInterval(waveTimer);
    waveTimer = null;
    bots = {
        'dummy-1': { id: 'dummy-1', x: 1510, y: 1650, hp: 100, maxHp: 100, isBot: true, botType: 'dummy' },
        'dummy-2': { id: 'dummy-2', x: 1400, y: 1600, hp: 100, maxHp: 100, isBot: true, botType: 'dummy' },
        'dummy-3': { id: 'dummy-3', x: 1600, y: 1600, hp: 100, maxHp: 100, isBot: true, botType: 'dummy' }
    };
    for (const pid in players) players[pid].hp = 100;
    broadcast({ type: 'sync_bots', training_bots: bots });
}

function resetWaves() {
    waveNumber = 1;
    waveScheduled = false;
    waveActive = false;
    if (waveTimer) clearInterval(waveTimer);
    waveTimer = null;
    bots = {};
    for (const pid in projectiles) delete projectiles[pid];
    // Reset all player HP
    for (const pid in players) players[pid].hp = 100;
    broadcast({ type: 'sync_bots', training_bots: bots, waveNumber });
    scheduleNextWave();
}

function scheduleNextWave() {
    if (waveScheduled) return; 
    if (waveTimer) clearInterval(waveTimer); 
    
    waveScheduled = true;
    waveActive = false;
    broadcast({ type: 'wave_incoming', waveNumber });
    let countdown = 5; // User requested 5s
    waveTimer = setInterval(() => {
        countdown--;
        broadcast({ type: 'wave_countdown', count: countdown, waveNumber });
        if (countdown <= 0) {
            clearInterval(waveTimer);
            waveTimer = null;
            waveScheduled = false;
            if (globalGameMode === 'waves') {
                waveActive = true;
                spawnWave();
                broadcast({ type: 'sync_bots', training_bots: bots, waveNumber });
            }
        }
    }, 1000);
}

function spawnWave() {
    const count = 3 + waveNumber * 2;
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 600 + Math.random() * 400;
        const bx = Math.max(150, Math.min(2850, 1500 + Math.cos(angle) * dist));
        const by = Math.max(150, Math.min(2850, 1500 + Math.sin(angle) * dist));
        const bId = `slime-${botNextId++}`;
        bots[bId] = {
            id: bId,
            x: bx, y: by,
            hp: 40 + waveNumber * 5, maxHp: 40 + waveNumber * 5,
            isBot: true, botType: 'slime',
            speed: 1.5 + Math.random() * 1.5,
            effects: {}
        };
    }
    console.log(`[WAVE] Wave ${waveNumber} spawned ${count} slimes.`);
}

wss.on('connection', (ws) => {
    const id = nextId++;
    players[id] = { id, x: 1500, y: 1500, hp: 100, dirX: 1, dirY: 0 };
    console.log(`[+] Player ${id} connected. Syncing bots:`, Object.keys(bots));
    
    // Broadcast to others
    broadcast({ type: 'player_joined', id, state: players[id] });
    
    // Sync current state to new player
    const syncData = { type: 'sync', id, players, training_bots: bots };
    console.log("[SERVER] Sending SYNC packet with", Object.keys(bots).length, "bots.");
    ws.send(JSON.stringify(syncData));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'request_mode') {
                if (waveTimer) clearInterval(waveTimer);
                waveTimer = null;
                waveScheduled = false;
                waveActive = false;

                if (globalGameMode === data.mode && data.mode !== 'waves') {
                    ws.send(JSON.stringify({ type: 'sync_bots', training_bots: bots }));
                    return;
                }
                globalGameMode = data.mode;
                console.log(`[MODE] Changing game mode to: ${globalGameMode}`);
                if (globalGameMode === 'practice') resetPractice();
                else if (globalGameMode === 'waves') resetWaves();
                return;
            }

            if (data.type === 'spell_cast') {
                const p = players[id];
                const spawnX = data.x ?? p.x;
                const spawnY = data.y ?? p.y;
                const dx = data.dirX ?? p.dirX ?? 1;
                const dy = data.dirY ?? p.dirY ?? 0;
                
                const projId = projNextId++;
                const proj = {
                    id: projId,
                    owner: id,
                    x: spawnX + dx * 20,
                    y: spawnY + dy * 20,
                    dx: dx,
                    dy: dy,
                    element: data.element,
                    speed: 35,
                    life: 0,
                    radius: 35
                };
                projectiles[projId] = proj;
                broadcast({ type: 'projectile_spawn', projectile: proj });
            }
            
            if (data.type === 'master_spell') {
                const p = players[id];
                const spawnX = data.x ?? p.x;
                const spawnY = data.y ?? p.y;
                const dx = data.dirX ?? p.dirX ?? 1;
                const dy = data.dirY ?? p.dirY ?? 0;
                
                const projId = projNextId++;
                const proj = {
                    id: projId,
                    owner: id,
                    x: spawnX + dx * 20,
                    y: spawnY + dy * 20,
                    dx: dx,
                    dy: dy,
                    element: data.spellName, // Important: use the actual combo name for physics
                    el1: data.el1,
                    el2: data.el2,
                    speed: 45,
                    life: 0,
                    radius: 50,
                    damage: 30
                };
                projectiles[projId] = proj;
                broadcast({ type: 'projectile_spawn', projectile: proj });
            }
            
            if (data.type === 'player_move') {
                players[id].x = data.x;
                players[id].y = data.y;
                if (data.dirX !== 0 || data.dirY !== 0) {
                    players[id].dirX = data.dirX;
                    players[id].dirY = data.dirY;
                }
                broadcast({ type: 'player_moved', id, x: data.x, y: data.y, dirX: players[id].dirX, dirY: players[id].dirY });
            }
            // More logic like moving...
        } catch (e) {
            console.error('Failed to parse message:', e);
        }
    });

    ws.on('close', () => {
        console.log(`[-] Player ${id} disconnected.`);
        delete players[id];
        broadcast({ type: 'player_left', id });

        // If no players left, reset server state completely
        if (Object.keys(players).length === 0) {
            console.log("[SERVER] No players left. Resetting world state.");
            globalGameMode = 'menu';
            waveNumber = 1;
            waveScheduled = false;
            waveActive = false;
            if (waveTimer) clearInterval(waveTimer);
            waveTimer = null;
            bots = {};
            for (const pid in projectiles) delete projectiles[pid];
        }
    });
});

function broadcast(msg) {
    const data = JSON.stringify(msg);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// Element Mechanics Logic
function applyElementHit(entity, proj, entityId, isBot) {
    let damage = proj.damage || 10;
    
    // Assign mapped damage based on Element
    switch(proj.element) {
        case 'Wind': damage = 10; break;
        case 'Water': damage = 15; break;
        case 'Fire': damage = 15; break;
        case 'Earth': damage = 25; break;
        case 'Mudslide Trap': damage = 30; break;
        case 'Magma Eruption': damage = 35; break;
        case 'Inferno Tornado': damage = 20; break;
        case 'Blizzard Storm': damage = 20; break;
    }
    
    entity.hp -= damage;
    
    if (!entity.effects) entity.effects = {};
    const now = Date.now();
    
    // 1. KNOCKBACK PHYSICS
    let kb = 0;
    if (proj.element === 'Wind') kb = 80;
    else if (proj.element === 'Blizzard Storm') kb = 60;
    else if (proj.element === 'Inferno Tornado') kb = 200;
    
    if (kb > 0) {
        entity.x += proj.dx * kb;
        entity.y += proj.dy * kb;
        entity.x = Math.max(100, Math.min(2900, entity.x));
        entity.y = Math.max(100, Math.min(2900, entity.y));
    }
    
    // 2. STATUS EFFECTS
    if (proj.element === 'Fire') {
        entity.effects['burn'] = { expires: now + 3000, lastTick: now, damagePerSec: 5 };
    } else if (proj.element === 'Earth') {
        entity.effects['stun'] = { expires: now + 1500 };
    } else if (proj.element === 'Water') {
        entity.effects['slow'] = { expires: now + 3000, speedMod: 0.5 };
    } else if (proj.element === 'Magma Eruption') {
        entity.effects['burn'] = { expires: now + 3000, lastTick: now, damagePerSec: 10 };
        entity.effects['stun'] = { expires: now + 2000 };
    } else if (proj.element === 'Inferno Tornado') {
        entity.effects['burn'] = { expires: now + 3000, lastTick: now, damagePerSec: 5 };
    } else if (proj.element === 'Blizzard Storm') {
        entity.effects['slow'] = { expires: now + 4000, speedMod: 0.1 };
    } else if (proj.element === 'Mudslide Trap') {
        entity.effects['stun'] = { expires: now + 1000 };
        entity.effects['slow'] = { expires: now + 4000, speedMod: 0.4 };
    }
    
    // Inform clients that this entity received new effects & might've been knocked back
    if (isBot) {
        broadcast({ type: 'bot_moved', id: entityId, x: entity.x, y: entity.y });
    } else {
        broadcast({ type: 'player_moved', id: entityId, x: entity.x, y: entity.y, dirX: entity.dirX, dirY: entity.dirY });
    }
    broadcast({ type: 'effects_applied', id: entityId, effects: entity.effects, isBot });
}

function tickEffects(entity, id, isBot) {
    if (!entity.effects) return;
    const now = Date.now();
    let hpChanged = false;
    let effectsChanged = false;
    
    for (const [effectName, effect] of Object.entries(entity.effects)) {
        if (now > effect.expires) {
            delete entity.effects[effectName];
            effectsChanged = true;
            continue;
        }
        if (effectName === 'burn') {
            if (now - effect.lastTick >= 1000) {
                entity.hp -= effect.damagePerSec;
                if (entity.hp <= 0) {
                    if (isBot && entity.botType === 'dummy') {
                        entity.hp = entity.maxHp;
                    } else if (isBot) { // Slime died
                        broadcast({ type: 'bot_removed', id });
                        delete bots[id];
                        continue;
                    }
                }
                effect.lastTick = now;
                hpChanged = true;
            }
        }
    }
    
    if (hpChanged) {
        broadcast({ type: isBot ? 'bot_hit' : 'player_hit', id, hp: entity.hp, isDoT: true });
    }
    if (effectsChanged) {
        broadcast({ type: 'effects_applied', id, effects: entity.effects, isBot });
    }
}

// Enemy AI Logic
function updateBots() {
    if (globalGameMode !== 'waves') return;
    
    let activePlayers = Object.values(players);
    if (activePlayers.length === 0) return;
    
    let remainingSlimes = 0;
    
    for (const bid in bots) {
        let b = bots[bid];
        if (b.botType !== 'slime') continue;
        
        // Handle death
        if (b.hp <= 0) {
            delete bots[bid];
            broadcast({ type: 'bot_removed', id: bid });
            continue;
        }
        
        remainingSlimes++;
        
        let canMove = true;
        let cSpeed = b.speed || 1.5;
        if (b.effects) {
            if (b.effects['stun']) canMove = false;
            if (b.effects['slow']) cSpeed *= b.effects['slow'].speedMod;
        }
        
        if (canMove) {
            // Find nearest player
            let targetP = activePlayers[0];
            let minDist = Math.hypot(b.x - targetP.x, b.y - targetP.y);
            for (let i=1; i<activePlayers.length; i++) {
                let d = Math.hypot(b.x - activePlayers[i].x, b.y - activePlayers[i].y);
                if (d < minDist) { minDist = d; targetP = activePlayers[i]; }
            }
            
            // Move towards player with bounds clamping
            if (minDist > 15) {
                let dx = targetP.x - b.x;
                let dy = targetP.y - b.y;
                let len = Math.hypot(dx, dy);
                b.x = Math.max(100, Math.min(2900, b.x + (dx / len) * cSpeed));
                b.y = Math.max(100, Math.min(2900, b.y + (dy / len) * cSpeed));
            } else {
                // Melee hit player
                if (Math.random() < 0.05) {
                    targetP.hp = Math.max(0, targetP.hp - 5);
                    broadcast({ type: 'player_hit', id: targetP.id, hp: targetP.hp });
                    if (targetP.hp <= 0) {
                        broadcast({ type: 'game_over', id: targetP.id });
                    }
                }
            }
        }
    }
    
    // Check Wave End — only trigger if wave was actually active and all slimes are gone
    if (waveActive && remainingSlimes === 0 && Object.keys(bots).length === 0) {
        waveActive = false;
        waveNumber++;
        scheduleNextWave();
    }
}

// Map Architect (Gemini) stub & Projectile Loop
setInterval(() => {
    // Check effects (DoT, Expiry)
    for (const pid in players) tickEffects(players[pid], pid, false);
    for (const bid in bots) tickEffects(bots[bid], bid, true);
    
    // Move Bots
    updateBots();
    
    // Check projectiles
    for (const pid in projectiles) {
        let proj = projectiles[pid];
        proj.x += proj.dx * proj.speed;
        proj.y += proj.dy * proj.speed;
        proj.life++;
        
        // Expire after ~3 seconds (90 ticks)
        if (proj.life > 90) {
            delete projectiles[pid];
            broadcast({ type: 'projectile_destroyed', id: pid });
            continue;
        }
        
        // Collision with Players
        for (const playerId in players) {
            if (parseInt(playerId) === proj.owner) continue;
            const p = players[playerId];
            const dist = Math.hypot(p.x - proj.x, p.y - proj.y);
            const projRad = proj.radius || 35;
            if (dist < 30 + projRad) {
                applyElementHit(p, proj, playerId, false);
                delete projectiles[pid];
                broadcast({ type: 'projectile_destroyed', id: pid });
                broadcast({ type: 'player_hit', id: playerId, hp: p.hp });
                break;
            }
        }

        // Collision with Bots
        if (projectiles[pid]) { // If not already destroyed by player hit
            for (const botId in bots) {
                const b = bots[botId];
                const dist = Math.hypot(b.x - proj.x, b.y - proj.y);
                const projRad = proj.radius || 35;
                if (dist < 40 + projRad) {
                    applyElementHit(b, proj, botId, true);
                    
                    if (b.hp <= 0) {
                        if (b.botType === 'dummy') {
                            b.hp = b.maxHp; // Heal dummy back to full
                            broadcast({ type: 'bot_hit', id: botId, hp: b.hp, x: proj.x, y: proj.y });
                        } else if (b.botType === 'slime') {
                            // Delete slime permanently
                            delete bots[botId];
                            broadcast({ type: 'bot_removed', id: botId });
                        }
                    } else {
                        broadcast({ type: 'bot_hit', id: botId, hp: b.hp, x: proj.x, y: proj.y });
                    }
                    
                    delete projectiles[pid];
                    broadcast({ type: 'projectile_destroyed', id: pid });
                    break;
                }
            }
        }
    }

    // Periodical Sync of Bots to all clients (Every 2 seconds)
    // Periodical Sync of Bots to all clients (Every 2 seconds)
    if (Math.floor(Date.now() / 2000) !== Math.floor((Date.now() - 33) / 2000)) {
        broadcast({ type: 'sync_bots', training_bots: bots, waveNumber });
    }
    // Update bot positions smoothly on clients (30 FPS sync)
    if (globalGameMode === 'waves') {
        for (const bid in bots) {
             broadcast({ type: 'bot_moved', id: bid, x: bots[bid].x, y: bots[bid].y });
        }
    }
}, 1000 / 30); // 30 FPS Server Loop

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
