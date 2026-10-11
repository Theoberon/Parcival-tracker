import { realDeps } from '../_shared/deps.ts';
import { handle } from './handler.ts';

const deps = realDeps();
Deno.serve((req) => handle(req, deps));
