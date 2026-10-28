import { createFileRoute } from "@tanstack/react-router";
import { ConveneSettingsPanel } from "../components/convene/ConveneSettingsPanel";

export const Route = createFileRoute("/_chat/settings/convene")({
  component: ConveneSettingsPanel,
});
