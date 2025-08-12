import { v4 as uuidV4 } from 'uuid';

// Use sessionStorage so each browser tab has a stable, unique ID
let sessionId = sessionStorage.getItem('kupid-sessionId');

if (!sessionId) {
  sessionId = uuidV4();
  sessionStorage.setItem('kupid-sessionId', sessionId);
}

export const getSessionId = () => sessionId!;
