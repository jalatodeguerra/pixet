import { serveRpc, type RpcScope } from "../workers/workerRpc.ts";
import { runAutoWeightJob, type AutoWeightJob } from "./autoWeightJob.ts";
import type { BoneWeights } from "./RigEngine.ts";

serveRpc<AutoWeightJob, BoneWeights>(self as unknown as RpcScope, (job) => ({
  result: runAutoWeightJob(job),
}));
