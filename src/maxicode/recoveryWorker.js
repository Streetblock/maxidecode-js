import { recoverDamagedMaxiCode } from "./recovery.js";

self.addEventListener("message", (event) => {
  try {
    const result = recoverDamagedMaxiCode(event.data.imageData);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
});
