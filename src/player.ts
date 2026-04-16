import { PlayerApp } from './player/PlayerApp.ts';

const app = new PlayerApp();
app.init().catch(console.error);
