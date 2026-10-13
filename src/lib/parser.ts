import type { Command, Flag } from "./schema";

export function cleanHelp(text: string) {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/.\x08/g, "").replace(/\r/g, "").slice(0, 160_000);
}

export function parseHelp(tool: string, path: string[], raw: string, source: Command["source"] = "help"): Command {
  const help = cleanHelp(raw);
  const lines = help.split("\n");
  const children: Command["children"] = [];
  const flags: Flag[] = [];
  let section = "", lastFlag: Flag | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { lastFlag = undefined; continue; }
    if (!/^\s/.test(line) && !/^[\w.-]+\s{2,}/.test(line)) {
      section = trimmed.replace(/:$/, ""); lastFlag = undefined;
    }
    // npm's short help puts its option signatures in bracketed rows.
    if (tool === "npm" && /^\[/.test(trimmed)) {
      for (const match of trimmed.matchAll(/\[(?:(-[\w-]+)\|)?(--?[\w-]+)(?:[= ]+(<[^>]+>))?/g)) {
        if (!flags.some(f => f.name === match[2])) flags.push({ name: match[2], aliases: match[1] ? [match[1]] : [], value: match[3] ?? "", description: "See the source reference for this option.", joinValue: false });
      }
    }
    const flagMatch = line.match(/^\s*((?:--?[a-zA-Z0-9][\w-]*(?:[= ][^,\s]+)?(?:,\s*|\s+or\s+)?)+)\s{2,}(.+)$/);
    if (flagMatch && /^-/.test(trimmed)) {
      const names = [...flagMatch[1].matchAll(/(?:^|[,\s])(--?[a-zA-Z0-9][\w-]*)/g)].map(m => m[1]);
      if (!names.length) continue;
      const name = names.find(n => n.startsWith("--")) ?? names[0];
      const value = flagMatch[1].replace(/--?[a-zA-Z0-9][\w-]*/g, "").replace(/[,=]/g, "").trim().replace(/^or\s+/, "");
      if (!flags.some(f => f.name === name)) {
        lastFlag = { name, aliases: names.filter(n => n !== name), value, description: flagMatch[2].trim(), joinValue: /\[?=/.test(flagMatch[1]) };
        flags.push(lastFlag);
      }
      continue;
    }
    // Man pages often put an option signature on its own line.
    if (/^\s+--?[a-zA-Z0-9]/.test(line) && !/\s{2,}\S/.test(trimmed)) {
      const names = [...trimmed.matchAll(/(?:^|[,\s])(--?[a-zA-Z0-9][\w-]*)/g)].map(m => m[1]);
      if (names.length && !flags.some(f => names.includes(f.name))) {
        lastFlag = { name: names.find(n => n.startsWith("--")) ?? names[0], aliases: names.filter(n => n !== (names.find(n => n.startsWith("--")) ?? names[0])), value: trimmed.replace(/--?[a-zA-Z0-9][\w-]*/g, "").replace(/[,=]/g, "").trim(), description: "", joinValue: /\[?=/.test(trimmed) };
        flags.push(lastFlag);
      }
      continue;
    }
    if (lastFlag && /^\s{6,}\S/.test(line)) {
      lastFlag.description += " " + trimmed; continue;
    }
    const commandSection = (/commands|subcommands/i.test(section) || (tool === "pnpm" && /dependencies|scripts|other/i.test(section))) && !/external|alias|file formats|interfaces/i.test(section);
    if (commandSection) {
      const m = line.match(/^\s{1,8}([a-zA-Z0-9][\w.+-]*(?:,\s*[\w.+-]+)*):?\s{2,}(.+)$/);
      const name = m?.[1].split(/,\s*/).at(-1);
      if (m && name && !children.some(c => c.name === name) && !/^(options|flags|usage|help)$/i.test(name)) children.push({ name, description: m[2].trim(), group: section });
      if (/^\s+[\w-]+(?:,\s+[\w-]+)+,?\s*$/.test(line)) {
        for (const name of trimmed.split(/,\s*/).filter(Boolean)) if (!children.some(c => c.name === name)) children.push({ name, description: "Open command reference", group: section });
      }
    }
  }
  const usageIndex = lines.findIndex(l => /^\s*(usage|synopsis)\b/i.test(l));
  const usage = usageIndex < 0 ? [tool, ...path].join(" ") : lines.slice(usageIndex, usageIndex + 5).join("\n").trim();
  const nameIndex = lines.findIndex(l => /^NAME\s*$/.test(l.trim()));
  const manDescription = nameIndex < 0 ? undefined : lines.slice(nameIndex + 1).find(l => l.trim())?.trim().replace(/^[\w.+-]+\s+[-–—]\s*/, "");
  const description = (source === "man" ? manDescription : undefined) ?? lines.find(l => l.trim() && !/^\s/.test(l) && !/^(usage|name|synopsis|options|commands|flags)\b/i.test(l))?.trim() ?? `${[tool, ...path].join(" ")} command reference`;
  return { tool, path, title: path.at(-1) ?? tool, description, usage, children, flags, help, source, generatedAt: new Date().toISOString(), fingerprint: "", enrichment: "parser" };
}

export function shellQuote(value: string) {
  return /^[a-zA-Z0-9_./:@%+=,-]+$/.test(value) ? value : "'" + value.replace(/'/g, "'\\''") + "'";
}
export function displayCommand(tool: string, argv: string[]) { return [tool, ...argv].map(shellQuote).join(" "); }

export function buildArgv(command: Command, values: Record<string, string | boolean>, positionals: string[]) {
  const argv = [...command.path];
  for (const [name, value] of Object.entries(values)) {
    const flag = command.flags.find(f => f.name === name);
    if (!flag) throw new Error(`Unknown flag: ${name}`);
    if (value === false || value === "") continue;
    if (flag.value) {
      if (typeof value !== "string") throw new Error(`${name} requires a value`);
      if (flag.joinValue) argv.push(name + "=" + value); else argv.push(name, value);
    } else {
      if (value !== true) throw new Error(`${name} is a switch`);
      argv.push(name);
    }
  }
  if (positionals.some(p => p.startsWith("-"))) throw new Error("Add options through the documented flag fields. Positional arguments cannot start with a dash.");
  return [...argv, ...positionals];
}
