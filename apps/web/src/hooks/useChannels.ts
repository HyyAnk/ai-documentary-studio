import { useCallback, useRef, useState } from "react";
import type { Channel } from "@studio/shared";
import { api } from "../api";

export function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => { const sequence = ++refreshSequence.current; const response = await api.channels(); if (sequence === refreshSequence.current) setChannels(response.channels); return response.channels; }, []);
  return { channels, setChannels, refresh };
}
