import { ProjectorApp } from './projector/ProjectorApp.ts';

if (__VERCEL_DEPLOY__) {
  void import('@vercel/analytics').then((m) => m.inject()).catch(() => { /* silent */ });
}

const app = new ProjectorApp();
app.init().catch(console.error);
