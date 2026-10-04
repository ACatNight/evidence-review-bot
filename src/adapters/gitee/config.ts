import { z } from "zod";

const repositoryId = z.string().regex(/^\d+$/);
const nonempty = z.string().min(1);
const workerRepository = z.object({
  id: repositoryId,
  owner: nonempty,
  name: nonempty,
  token: nonempty,
});
const webhookRepository = z.object({
  id: repositoryId,
  secret: z.string().min(32),
  authMode: z.enum(["signature", "token"]).default("signature"),
});

function parseRepositories<T extends { id: string }>(
  json: string | undefined,
  schema: z.ZodType<T>,
): T[] {
  if (!json) return [];
  const repositories = z.array(schema).parse(JSON.parse(json));
  const ids = repositories.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate Gitee repository ID");
  return repositories;
}

export function parseGiteeWorkerRepositories(json: string | undefined) {
  return parseRepositories(json, workerRepository);
}

export function parseGiteeWebhookRepositories(json: string | undefined) {
  return parseRepositories(json, webhookRepository);
}
