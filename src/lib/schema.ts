import { z } from "zod";

export const token = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.+-]*$/).max(100);
export const flagSchema = z.object({
  name: z.string().regex(/^--?[a-zA-Z0-9][a-zA-Z0-9-]*$/),
  aliases: z.array(z.string()).default([]),
  value: z.string(), description: z.string(), joinValue: z.boolean().default(false),
});
export const commandSchema = z.object({
  tool: token, path: z.array(token).max(12), title: z.string(), description: z.string(),
  usage: z.string(), flags: z.array(flagSchema),
  children: z.array(z.object({ name: token, description: z.string(), group: z.string() })),
  help: z.string(), source: z.enum(["help", "man", "import"]),
  generatedAt: z.string(), fingerprint: z.string(),
  enrichment: z.enum(["parser", "ai"]).default("parser"),
});
export type Command = z.infer<typeof commandSchema>;
export type Flag = z.infer<typeof flagSchema>;
export type Tool = { name: string; executable: string; cached: boolean };
export type Run = { id: string; command: string; cwd: string; state: "running" | "completed" | "cancelled" | "timeout" | "failed"; stdout: string; stderr: string; code: number | null; startedAt: number; duration: number; truncated: boolean };
