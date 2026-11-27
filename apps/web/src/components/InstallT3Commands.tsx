import { T } from "gt-react";
import { cn } from "~/lib/utils";

import { CommandBlock } from "./CommandBlock";

export function InstallT3Commands({
  command,
  className,
}: {
  readonly command: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-xs text-muted-foreground">
        <T>
          On the host, install T3 Code for Convene from the platform's desktop client downloads or
          use a matching CLI provided by your organization. Add the installed
          <code className="font-mono"> t3 </code> command to PATH, then run:
        </T>
      </p>
      <CommandBlock command={command} />
    </div>
  );
}
