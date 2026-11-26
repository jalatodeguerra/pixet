import { serveRpc, type RpcScope } from "../workers/workerRpc.ts";
import {
  runQuantizeJob,
  type QuantizeJob,
  type QuantizeResult,
} from "./quantizeJob.ts";

serveRpc<QuantizeJob, QuantizeResult>(self as unknown as RpcScope, (job) => {
  const result = runQuantizeJob(job);
  return { result, transfer: [result.data.buffer] };
});
