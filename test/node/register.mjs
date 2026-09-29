// Node test setup: resolve @kabelsalat/web to its ESM build and load .strudel files as text.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
