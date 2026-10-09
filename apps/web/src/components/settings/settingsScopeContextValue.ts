import { createContext } from "react";
import type { SettingsScopeContextValue } from "./SettingsScopeContext";

// Keep the provider and route consumers on one context when the translated
// settings module is replaced by Fast Refresh.
export const SettingsScopeContext = createContext<SettingsScopeContextValue | null>(null);
