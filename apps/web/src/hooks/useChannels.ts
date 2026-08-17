import { useCallback, useEffect, useState } from "react";
import type { Channel } from "@studio/shared";
import { api } from "../api";

export function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const refresh = useCallback(async () => { const response = await api.channels(); setChannels(response.channels); return response.channels; }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { channels, setChannels, refresh };
}
