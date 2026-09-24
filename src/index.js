import "dotenv/config";
import { createServer } from "./server.js";
import { startScheduler } from "./scheduler.js";

const port = process.env.PORT || 3000;

const app = createServer();
app.listen(port, () => {
  console.log(`[server] http://localhost:${port} 에서 대기 중`);
  startScheduler();
});
