// public/network.js

export class GameNetwork {
    constructor(onStateUpdate, onPlayerEvent) {
        this.socket = new WebSocket(`ws://${location.host}`);
        this.onStateUpdate = onStateUpdate;
        this.onPlayerEvent = onPlayerEvent;
        
        this.socket.onopen = () => {
            console.log("Connected to Game Server");
        };
        
        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
    }
    
    handleMessage(data) {
        switch(data.type) {
            case 'sync':
            case 'sync_bots':
            case 'player_joined':
            case 'player_left':
            case 'player_moved':
            case 'bot_moved':
            case 'bot_removed':
            case 'projectile_spawn':
            case 'projectile_destroyed':
            case 'player_hit':
            case 'bot_hit':
            case 'effects_applied':
            case 'wave_incoming':
            case 'wave_countdown':
            case 'game_over':
                if (this.onStateUpdate) this.onStateUpdate(data);
                break;
            case 'spell_cast':
            case 'master_spell':
                if (this.onPlayerEvent) this.onPlayerEvent(data);
                break;
        }
    }
    
    sendSpellCast(element, x, y, dirX, dirY) {
        if (this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type: 'spell_cast', element, x, y, dirX, dirY }));
        }
    }
    
    sendMasterSpell(spellName, el1, el2, x, y, dirX, dirY) {
        if (this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type: 'master_spell', spellName, el1, el2, x, y, dirX, dirY }));
        }
    }
    
    sendMove(x, y, dirX, dirY) {
        if (this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type: 'player_move', x, y, dirX, dirY }));
        }
    }
}
