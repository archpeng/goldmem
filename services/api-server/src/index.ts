import { buildServer } from "./routes.js";
import { buildKernelDepsFromEnv, buildTemporalMemoryFromEnv, parsePositiveInt } from "./runtime.js";
import { startMemoryProcessingWorker } from "./health-worker.js";

export { buildServer } from "./routes.js";
export { buildKernelDepsFromEnv, buildTemporalMemoryFromEnv } from "./runtime.js";
export { apiRouteContract, type ApiRouteContract, type ApiServerDeps } from "./server-types.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  const { deps, close } = buildKernelDepsFromEnv();
  const server = buildServer(deps);
  const port = Number(process.env.PORT ?? 3000);
  const stopMemoryWorker = startMemoryProcessingWorker(deps.kernel, parsePositiveInt);
  server.listen({ port, host: "0.0.0.0" }).catch(async (error) => {
    server.log.error(error);
    stopMemoryWorker();
    await close();
    process.exit(1);
  });
}
