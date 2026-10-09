import type { DevicePlatformAvailability } from "@t3tools/contracts";
import { Check, Minus } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { useTranslate } from "../../i18n";
import { formatDeviceMessage } from "./deviceMessages";

export function DeviceHostAvailability({
  platforms,
}: {
  platforms: ReadonlyArray<DevicePlatformAvailability>;
}) {
  const t = useTranslate();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {platforms.map((platform) => {
        const label = t(
          platform.available ? "device.platform.available" : "device.platform.unavailable",
          { platform: platform.platform === "ios" ? "iOS" : "Android" },
        );
        return (
          <Tooltip key={platform.platform}>
            <TooltipTrigger
              render={<span tabIndex={0} className="inline-flex items-center gap-1" />}
            >
              {platform.available ? <Check className="size-3" /> : <Minus className="size-3" />}
              {label}
            </TooltipTrigger>
            <TooltipPopup>
              {platform.reason ? formatDeviceMessage(platform.reason, t) : label}
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}
