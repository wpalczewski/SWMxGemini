// public/vision.js

export class VisionSubsystem {
    constructor(videoElement, canvasElement) {
        this.videoElement = videoElement;
        this.canvasElement = canvasElement;
        this.ctx = canvasElement.getContext('2d');
        
        // Gesture Tracking state
        this.trail = []; // Stores {x, y, time}
        this.isDrawing = false; // State machine
        
        // Spell Combo state (Sequential)
        this.chargedElement = null;
        this.fistHoldStartTime = null;
        this.chargeExpirationTime = null;
        
        // Cooldowns to prevent spam
        this.cooldownTimer = 0;
        this.CAST_COOLDOWN = 1000;
        
        // Callbacks
        this.onElementCasted = null;
        this.onMasterSpellCasted = null;
        this.onRuneUpdate = null; // Used to update the visual rune above the head
        
        this.initMediaPipe();
    }
    
    initMediaPipe() {
        this.hands = new window.Hands({locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }});
        
        this.hands.setOptions({
            maxNumHands: 1, // Let's focus on 1 hand for casting
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.7
        });
        
        this.hands.onResults(this.onResults.bind(this));
        
        this.camera = new window.Camera(this.videoElement, {
            onFrame: async () => {
                await this.hands.send({image: this.videoElement});
            },
            width: 320,
            height: 240
        });
        
        this.camera.start();
    }
    
    onResults(results) {
        this.ctx.save();
        this.ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
        
        // Draw webcam feed mirror
        this.ctx.translate(this.canvasElement.width, 0);
        this.ctx.scale(-1, 1);
        this.ctx.drawImage(results.image, 0, 0, this.canvasElement.width, this.canvasElement.height);
        
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            for (const landmarks of results.multiHandLandmarks) {
                // Subtle hand joints
                window.drawConnectors(this.ctx, landmarks, window.HAND_CONNECTIONS,
                                      {color: 'rgba(0, 255, 255, 0.4)', lineWidth: 1});
                window.drawLandmarks(this.ctx, landmarks, {color: 'rgba(176, 0, 255, 0.4)', lineWidth: 1});
                
                this.trackAndAnalyzeGesture(landmarks);
                this.drawTrail();
            }
        } else {
            // Hand lost -> Pause & clear
            this.isDrawing = false;
            this.trail = [];
            // Only clear UI if we don't have something currently charged,
            // so flickering hands don't erase the charged text.
            if (!this.chargedElement && this.onRuneUpdate) {
                this.onRuneUpdate(null);
            }
        }
        this.ctx.restore();
    }
    
    trackAndAnalyzeGesture(landmarks) {
        const now = Date.now();
        const isFist = this.checkFist(landmarks);
        
        // Do not process new traces if cooldown is active
        if (now - this.cooldownTimer < this.CAST_COOLDOWN) {
            this.isDrawing = false;
            this.trail = [];
            return;
        }
        
        if (isFist) {
            // FIST = PAUSED / SUBMIT / HOLD TO CAST
            if (this.isDrawing) {
                // We just closed our hand -> analyze the drawing
                this.isDrawing = false;
                const element = this.analyzeTrailToElement();
                this.trail = []; 
                
                if (element) {
                    if (this.chargedElement) {
                        // We already had a charged element. COMBO TIME!
                        const masterSpell = this.determineMasterSpell(this.chargedElement, element);
                        if (masterSpell && this.onMasterSpellCasted) {
                            this.onMasterSpellCasted(masterSpell, this.chargedElement, element);
                        }
                        this.cooldownTimer = now;
                        this.resetCharge();
                    } else {
                        // First element drawn, charge it and start hold timer
                        this.chargedElement = element;
                        this.fistHoldStartTime = now;
                        if (this.onRuneUpdate) this.onRuneUpdate(element);
                    }
                } else {
                    // Invalid shape
                    if (!this.chargedElement && this.onRuneUpdate) this.onRuneUpdate(null);
                }
            } else {
                // Hand was already closed, check if we are holding to cast
                if (this.chargedElement && this.fistHoldStartTime) {
                    if (now - this.fistHoldStartTime > 800) {
                        // Held long enough -> Cast basic spell!
                        this.triggerCast(this.chargedElement);
                        this.resetCharge();
                    }
                }
            }
        } else {
            // HAND OPEN = DRAWING
            this.isDrawing = true;
            
            // If we have a charged element, opening the hand cancels the hold timer
            // and starts the combo expiration timer if not already started.
            if (this.chargedElement) {
                this.fistHoldStartTime = null;
                if (!this.chargeExpirationTime) {
                    this.chargeExpirationTime = now + 3000; // 3 seconds to complete the combo
                }
                
                if (now > this.chargeExpirationTime) {
                    // Took too long to draw the second shape. Reset.
                    this.resetCharge();
                }
            }
            
            if (!this.chargedElement && this.onRuneUpdate) {
                this.onRuneUpdate('charging');
            }
            
            // Track Index Finger Tip
            const indexTip = landmarks[8];
            const px = indexTip.x;
            const py = indexTip.y;
            
            // Smooth adding point to trail
            if (this.trail.length > 0) {
                const lastP = this.trail[this.trail.length - 1];
                const dx = px - lastP.x;
                const dy = py - lastP.y;
                if (Math.hypot(dx, dy) > 0.01) {
                    this.trail.push({x: lastP.x + dx*0.5, y: lastP.y + dy*0.5, time: now});
                }
            } else {
                this.trail.push({x: px, y: py, time: now});
            }
            
            if (this.trail.length > 80) this.trail.shift();
        }
    }
    
    resetCharge() {
        this.chargedElement = null;
        this.fistHoldStartTime = null;
        this.chargeExpirationTime = null;
        if (this.onRuneUpdate) this.onRuneUpdate(null);
    }

    
    drawTrail() {
        if (this.trail.length < 2) return;
        
        const w = this.canvasElement.width;
        const h = this.canvasElement.height;
        
        this.ctx.beginPath();
        this.ctx.moveTo(this.trail[0].x * w, this.trail[0].y * h);
        for (let i = 1; i < this.trail.length; i++) {
            this.ctx.lineTo(this.trail[i].x * w, this.trail[i].y * h);
        }
        
        this.ctx.strokeStyle = '#00FFFF'; // Neon Cyan/Blue Magic Trail
        this.ctx.lineWidth = 5;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.shadowBlur = 15;
        this.ctx.shadowColor = '#00FFFF';
        this.ctx.stroke();
    }
    
    analyzeTrailToElement() {
        if (this.trail.length < 5) return null; // Too short, accidental close
        
        let minX = 1, maxX = 0, minY = 1, maxY = 0;
        this.trail.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });
        
        const width = maxX - minX;
        const height = maxY - minY;
        const startPoint = this.trail[0];
        const endPoint = this.trail[this.trail.length - 1];
        const netDist = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
        
        let pathDist = 0;
        for (let i = 1; i < this.trail.length; i++) {
            pathDist += Math.hypot(this.trail[i].x - this.trail[i-1].x, this.trail[i].y - this.trail[i-1].y);
        }

        // Prevent tiny twitches/accidental closures from triggering random spells
        if (width < 0.15 && height < 0.15 && pathDist < 0.3) {
            return null;
        }
        
        // 1. Earth (V-Shape / Chevron)
        let maxYIndex = 0;
        for (let i = 0; i < this.trail.length; i++) { if(this.trail[i].y === maxY) maxYIndex = i; }
        
        if (maxYIndex > 2 && maxYIndex < this.trail.length - 3) {
            // V-shape requires a definite plunge and rise
            if (maxY > startPoint.y + 0.12 && maxY > endPoint.y + 0.12) {
                return 'Earth';
            }
        }
        
        // 2. Water (Circle / Curve)
        if (pathDist > 0.4 && netDist < pathDist * 0.3) {
            return 'Water';
        }
        
        // 3. Simple Strokes (Fire & Wind)
        if (width > height * 1.5 && width > 0.2) {
            return 'Wind';
        }
        
        if (height > width * 1.5 && height > 0.2) {
            return 'Fire';
        }
        
        return null;
    }
    
    checkFist(landmarks) {
        const wrist = landmarks[0];
        let curledFingers = 0;
        const fingers = [
            { tip: 8, mcp: 5 },
            { tip: 12, mcp: 9 },
            { tip: 16, mcp: 13 },
            { tip: 20, mcp: 17 }
        ];
        
        for (let f of fingers) {
            const tipDist = this.getDist(landmarks[f.tip], wrist);
            const mcpDist = this.getDist(landmarks[f.mcp], wrist);
            if (tipDist < mcpDist * 1.3) {
                curledFingers++;
            }
        }
        // If at least 3 fingers are curled, it's a fist.
        return curledFingers >= 3;
    }
    
    getDist(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        return Math.sqrt(dx*dx + dy*dy);
    }
    
    triggerCast(element) {
        const now = Date.now();
        this.cooldownTimer = now;
        this.trail = [];
        
        if (this.onRuneUpdate) this.onRuneUpdate(element);
        
        if (this.onElementCasted) {
            this.onElementCasted(element);
        }
    }
    
    determineMasterSpell(el1, el2) {
        const set = new Set([el1.toLowerCase(), el2.toLowerCase()]);
        if (set.has('fire') && set.has('earth')) return 'Magma Eruption';
        if (set.has('water') && set.has('wind')) return 'Blizzard Storm';
        if (set.has('fire') && set.has('wind')) return 'Inferno Tornado';
        if (set.has('earth') && set.has('water')) return 'Mudslide Trap';
        return `Chaos Resonance (${el1} + ${el2})`; // Default combo fallback
    }
}
