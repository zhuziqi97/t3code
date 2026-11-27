import { useGT } from "gt-react-native";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SettingsSection } from "./components/SettingsSection";

export function OutdatedServerUpdateSection({ label }: { readonly label: string }) {
  const gt = useGT();
  return (
    <SettingsSection title="T3 Code">
      <View className="gap-1 p-4">
        <Text className="text-base text-foreground">{gt("Update required")}</Text>
        <Text className="text-sm text-foreground-muted">
          {gt(
            "Update T3 Code for Convene on {environment} using its installation source, then reconnect.",
            {
              environment: label,
            },
          )}
        </Text>
      </View>
    </SettingsSection>
  );
}
